"""Runs one download job, detached from Chrome, so closing the tab never kills it.

Usage: worker.py <job_id>
Progress is written to jobs/<job_id>.json for the host to stream to the extension.
On failure it self-heals: updates yt-dlp and retries, or retries with Chrome cookies.
"""
from __future__ import annotations

import contextlib
import glob
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

# Set only when run as a script, so the module can be imported (tests, tooling) without a job.
JOB_ID = sys.argv[1] if __name__ == "__main__" and len(sys.argv) > 1 else ""
JOB_PATH = os.path.join(common.JOBS_DIR, JOB_ID + ".json")
MAX_ATTEMPTS = 3

AUTH_HINTS = ("sign in to confirm", "age-restricted", "inappropriate for some users",
              "members-only", "join this channel", "private video", "cookies", "login required")
FIXABLE_HINTS = ("unable to extract", "nsig", "n challenge", "signature", "requested format is not available",
                 "http error 403", "precondition", "player response", "unsupported", "js runtime",
                 "challenge solving failed", "only images are available")
FINAL_HINTS = ("video unavailable", "removed by the uploader", "copyright", "is not available in your country",
               "premieres in", "this live event will begin", "does not exist")


class Cancelled(Exception):
    pass


def load() -> dict:
    return common.read_json(JOB_PATH, {}) or {}


_last_save = 0.0


def save(job: dict, force: bool = False) -> None:
    global _last_save
    now = time.time()
    if not force and now - _last_save < 0.4:
        return
    _last_save = now
    # Respect a cancel request written by the host.
    cur = common.read_json(JOB_PATH, {}) or {}
    if cur.get("cancelRequested"):
        job["cancelRequested"] = True
    job["updated"] = now
    common.write_json_atomic(JOB_PATH, job)
    if job.get("cancelRequested") and job.get("status") in ("running", "processing"):
        raise Cancelled()


def wait_for_slot(job: dict, cfg: dict) -> None:
    limit = max(1, int(cfg.get("maxConcurrent", 3)))
    while True:
        running = 0
        for p in glob.glob(os.path.join(common.JOBS_DIR, "*.json")):
            j = common.read_json(p, {}) or {}
            if j.get("id") != job["id"] and j.get("status") in ("running", "processing") \
                    and time.time() - j.get("updated", 0) < 120:
                running += 1
        if running < limit:
            return
        cur = load()
        if cur.get("cancelRequested"):
            raise Cancelled()
        time.sleep(1.5)


# Audio stream per format. m4a/opus are YouTube's originals (no re-encode); opus is the best stream.
AUDIO_FORMATS = {
    "mp3": "ba/b",
    "m4a": "ba[acodec^=mp4a]/ba/b",
    "opus": "ba[acodec=opus]/ba/b",
}


def video_sort(height: int | None, compatible: bool) -> list[str]:
    """yt-dlp format_sort: quality first, codec preference only as a tie-breaker.

    Resolution (capped at the chosen height), frame rate and HDR always win, so "Best" really is
    the best stream. With `compatible`, H.264/AAC is preferred only between otherwise equal options
    (e.g. 1080p60 SDR), which keeps files playable in QuickTime and editors without losing quality.
    Video and audio are only ever remuxed, never re-encoded.
    """
    sort = [f"res:{int(height)}" if height else "res", "fps", "hdr:12"]
    if compatible:
        sort += ["vcodec:h264", "acodec:aac"]
    return sort


def build_opts(job: dict, cfg: dict, hooks) -> dict:
    out_dir = common.download_dir(cfg)
    playlist = bool(job.get("playlist"))
    name = "%(title).180B.%(ext)s"
    if playlist:
        name = "%(playlist_title).120B/%(playlist_index)03d - %(title).160B.%(ext)s"
    if job.get("mode") == "thumbnail":
        name = "%(title).180B.%(ext)s"

    opts = {
        "paths": {"home": out_dir, "temp": os.path.join(common.APP_DIR, "tmp")},
        "outtmpl": {"default": name},
        "noplaylist": not playlist,
        "progress_hooks": [hooks["progress"]],
        "postprocessor_hooks": [hooks["post"]],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "retries": 10,
        "fragment_retries": 10,
        "continuedl": True,
        "concurrent_fragment_downloads": 4,
        "overwrites": False,
        "windowsfilenames": False,
        "ignoreerrors": "only_download" if playlist else False,
        "js_runtimes": common.js_runtimes(),
        "postprocessors": [],
    }
    ff = common.ffmpeg_path()
    if ff:
        opts["ffmpeg_location"] = ff
    if job.get("cookies"):
        opts["cookiesfrombrowser"] = (cfg.get("cookieBrowser") or "chrome",)

    mode = job.get("mode", "video")
    pps = opts["postprocessors"]

    if mode == "audio":
        fmt = job.get("audioFormat") or cfg.get("audioFormat", "mp3")
        opts["format"] = AUDIO_FORMATS.get(fmt, "ba/b")
        if fmt == "mp3":  # the only re-encode: MP3 for players that need it
            pps.append({"key": "FFmpegExtractAudio", "preferredcodec": "mp3",
                        "preferredquality": str(job.get("audioQuality") or cfg.get("audioQuality", "320"))})
        else:  # m4a / opus: YouTube's own stream, copied without re-encoding
            pps.append({"key": "FFmpegExtractAudio", "preferredcodec": fmt, "preferredquality": "0"})
        pps.append({"key": "FFmpegMetadata", "add_metadata": True})
        if cfg.get("embedThumbnail", True):
            opts["writethumbnail"] = True
            pps.append({"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"})
            pps.append({"key": "EmbedThumbnail", "already_have_thumbnail": False})
    elif mode == "thumbnail":
        opts["skip_download"] = True
        opts["writethumbnail"] = True
        pps.append({"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"})
    else:
        compatible = job.get("preferCompatible", cfg.get("preferCompatible", True))
        opts["format"] = "bv*+ba/b"
        opts["format_sort"] = video_sort(job.get("height"), compatible)
        opts["merge_output_format"] = "mp4"
        pps.append({"key": "FFmpegMetadata", "add_metadata": True, "add_chapters": True})
        if cfg.get("embedThumbnail", True):
            opts["writethumbnail"] = True
            pps.append({"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"})
            pps.append({"key": "EmbedThumbnail", "already_have_thumbnail": False})

        subs = job.get("subtitles") or cfg.get("subtitles", "off")
        if subs != "off":
            opts["writesubtitles"] = True
            opts["writeautomaticsub"] = True
            opts["subtitleslangs"] = [s.strip() for s in cfg.get("subtitleLangs", "en.*").split(",") if s.strip()]
            pps.append({"key": "FFmpegSubtitlesConvertor", "format": "srt", "when": "before_dl"})
            if subs == "embed":
                pps.append({"key": "FFmpegEmbedSubtitle", "already_have_subtitle": False})
    return opts


def run_once(job: dict, cfg: dict) -> None:
    import yt_dlp

    def progress(d):
        st = d.get("status")
        if st == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            info = d.get("info_dict") or {}
            job.update(status="running", stage="downloading",
                       downloaded=done, total=total, speed=d.get("speed") or 0, eta=d.get("eta"),
                       part=info.get("format_id"))
            # Merge of video+audio: weight the video stream heavier.
            frac = (done / total) if total else 0
            parts = job.setdefault("_parts", {})
            parts[str(info.get("format_id"))] = frac
            vals = list(parts.values())
            job["progress"] = round(100 * sum(vals) / max(len(vals), 2 if job.get("mode") == "video" else 1), 1)
            if info.get("playlist_index"):
                job["playlistIndex"] = info.get("playlist_index")
                job["playlistCount"] = info.get("n_entries") or info.get("playlist_count")
            if info.get("title") and not job.get("title"):
                job["title"] = info["title"]
            save(job)
        elif st == "finished":
            info = d.get("info_dict") or {}
            parts = job.setdefault("_parts", {})
            parts[str(info.get("format_id"))] = 1.0
            save(job)

    def post(d):
        if d.get("status") == "started":
            job.update(status="processing", stage=d.get("postprocessor", "Processing"))
            save(job, force=True)
        info = d.get("info_dict") or {}
        fp = info.get("filepath") or info.get("_filename")
        if fp and os.path.exists(fp):
            job["filepath"] = fp

    opts = build_opts(job, cfg, {"progress": progress, "post": post})
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(job["url"], download=True)
        if info:
            job["title"] = job.get("title") or info.get("title")
            if job.get("playlist"):
                job["filepath"] = os.path.join(common.download_dir(cfg), info.get("title") or "")
            else:
                for r in info.get("requested_downloads") or []:
                    if r.get("filepath"):
                        job["filepath"] = r["filepath"]
                if job.get("mode") == "thumbnail":
                    thumbs = [t.get("filepath") for t in info.get("thumbnails") or [] if t.get("filepath")]
                    if thumbs:
                        job["filepath"] = thumbs[-1]
                if not job.get("filepath"):
                    fp = ydl.prepare_filename(info)
                    if job.get("mode") == "audio":
                        fp = os.path.splitext(fp)[0] + "." + (job.get("audioFormat") or cfg.get("audioFormat", "mp3"))
                    elif job.get("mode") == "video":
                        fp = os.path.splitext(fp)[0] + ".mp4"
                    job["filepath"] = fp
                job["filepath"] = final_path(job["filepath"], cfg)


def final_path(fp: str, cfg: dict) -> str:
    """yt-dlp sometimes reports the temp-dir path of a file it later moved; point at the saved copy instead."""
    if os.path.exists(fp):
        return fp
    moved = os.path.join(common.download_dir(cfg), os.path.basename(fp))
    return moved if os.path.exists(moved) else fp


def classify(msg: str) -> str:
    m = msg.lower()
    if any(h in m for h in FINAL_HINTS):
        return "final"
    if any(h in m for h in AUTH_HINTS):
        return "auth"
    if any(h in m for h in FIXABLE_HINTS):
        return "fixable"
    return "unknown"


def respawn(job: dict) -> None:
    """Restart in a fresh process so a freshly updated yt-dlp is imported."""
    common.write_json_atomic(JOB_PATH, job)
    os.execv(common.VENV_PY, [common.VENV_PY, os.path.abspath(__file__), JOB_ID])


def main() -> None:
    job = load()
    if not job:
        return
    cfg = common.load_config()
    job["pid"] = os.getpid()
    job.setdefault("attempt", 1)
    try:
        if job.get("status") == "queued":
            job["stage"] = "waiting"
            save(job, force=True)
            wait_for_slot(job, cfg)
        job.update(status="running", stage="starting", error=None)
        save(job, force=True)
        run_once(job, cfg)
        job.pop("_parts", None)
        job.update(status="done", stage="done", progress=100, finished=time.time())
        save(job, force=True)
        name = os.path.basename(job.get("filepath") or job.get("title") or "Download")
        common.notify("Download complete", name)
    except Cancelled:
        job.update(status="cancelled", stage="cancelled")
        common.write_json_atomic(JOB_PATH, job)
        for p in glob.glob(os.path.join(common.APP_DIR, "tmp", "*")):
            if time.time() - os.path.getmtime(p) < 24 * 3600 and (job.get("title") or "~~") in p:
                with contextlib.suppress(OSError):
                    os.remove(p)
    except Exception as e:  # noqa: BLE001
        if (load() or {}).get("cancelRequested"):
            job.update(status="cancelled", stage="cancelled")
            common.write_json_atomic(JOB_PATH, job)
            return
        msg = str(e)
        kind = classify(msg)
        common.log("job", JOB_ID, "attempt", job.get("attempt"), kind, msg[:800])
        job.pop("_parts", None)
        if job["attempt"] < MAX_ATTEMPTS and kind != "final":
            job["attempt"] += 1
            if kind == "auth" and cfg.get("useCookies", True) and not job.get("cookies"):
                job.update(cookies=True, stage="retrying with your Chrome login", status="running")
                respawn(job)
            if kind in ("fixable", "unknown"):
                job.update(stage="updating yt-dlp", status="running")
                common.write_json_atomic(JOB_PATH, job)
                common.update_ytdlp(force=True)
                respawn(job)
        job.update(status="error", stage="error", error=msg.replace("ERROR: ", "")[:500])
        common.write_json_atomic(JOB_PATH, job)
        common.notify("Download failed", (job.get("title") or job["url"])[:80])


if __name__ == "__main__":
    os.makedirs(os.path.join(common.APP_DIR, "tmp"), exist_ok=True)
    main()
