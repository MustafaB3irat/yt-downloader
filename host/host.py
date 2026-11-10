"""Chrome native messaging host for YT Downloader.

Speaks Chrome's protocol (4-byte little-endian length + JSON) over stdin/stdout.
Works both for one-shot messages (chrome.runtime.sendNativeMessage) and for a
long-lived port (chrome.runtime.connectNative) that streams job progress.
"""
from __future__ import annotations

import contextlib
import glob
import json
import os
import signal
import struct
import subprocess
import sys
import threading
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

_write_lock = threading.Lock()
_subscribed = threading.Event()
INFO_TTL = 3600
KEEP_FINISHED_JOBS = 200        # older finished job records are deleted
ACTIVE = ("queued", "running", "processing")
FINISHED = ("done", "error", "cancelled")


def send(msg: dict) -> None:
    data = json.dumps(msg).encode("utf-8")
    with _write_lock:
        sys.stdout.buffer.write(struct.pack("<I", len(data)))
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def read() -> dict | None:
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode("utf-8"))


# ---------- jobs ----------

def public_job(j: dict) -> dict:
    return {k: v for k, v in j.items() if not k.startswith("_") and k != "pid"}


# Parsed job files keyed by path, reused while the file's (mtime, size) is unchanged. The pusher
# lists jobs every 0.5–2 s, so this keeps idle polling to a directory scan instead of parsing JSON.
_job_cache: dict[str, tuple[tuple[int, int], dict]] = {}
_job_cache_lock = threading.Lock()


def _read_jobs() -> list[tuple[str, dict]]:
    with _job_cache_lock:
        fresh: dict[str, tuple[tuple[int, int], dict]] = {}
        try:
            entries = [e for e in os.scandir(common.JOBS_DIR) if e.name.endswith(".json")]
        except OSError:
            entries = []
        for e in entries:
            try:
                st = e.stat()
            except OSError:
                continue
            sig = (st.st_mtime_ns, st.st_size)
            hit = _job_cache.get(e.path)
            if hit and hit[0] == sig:
                fresh[e.path] = hit
            elif job := common.read_json(e.path):
                fresh[e.path] = (sig, job)
        _job_cache.clear()
        _job_cache.update(fresh)
        return [(path, dict(job)) for path, (_, job) in fresh.items()]


def list_jobs(limit: int = 60) -> list[dict]:
    jobs = []
    for p, j in _read_jobs():
        # A worker that died without reporting (reboot, crash) is marked failed.
        if j.get("status") in ACTIVE and not _alive(j.get("pid")) \
                and time.time() - j.get("updated", j.get("created", 0)) > 20:
            j.update(status="error", stage="error", error="Helper stopped unexpectedly. Tap retry.")
            common.write_json_atomic(p, j)
        jobs.append(public_job(j))
    jobs.sort(key=lambda j: j.get("created", 0), reverse=True)
    _prune_finished(jobs)
    return jobs[:limit]


def _prune_finished(jobs: list[dict]) -> None:
    """Delete finished job records beyond the newest KEEP_FINISHED_JOBS (jobs is newest first)."""
    finished = [j for j in jobs if j.get("status") in FINISHED]
    for j in finished[KEEP_FINISHED_JOBS:]:
        remove_job(j["id"])


def _alive(pid) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False


def spawn_worker(job_id: str) -> None:
    # The child keeps its own copy of the log fd, so ours can be closed right away.
    with open(os.path.join(common.LOG_DIR, "worker.log"), "a") as log:
        subprocess.Popen(
            [common.VENV_PY, os.path.join(common.HOST_DIR, "worker.py"), job_id],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            start_new_session=True, close_fds=True,
        )


def start_job(msg: dict) -> dict:
    url = msg.get("url") or ""
    if not url.startswith(("https://", "http://")):
        return {"error": "Invalid URL"}
    job_id = time.strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:6]
    job = {
        "id": job_id, "url": url, "created": time.time(), "updated": time.time(),
        "status": "queued", "stage": "queued", "progress": 0,
        "mode": msg.get("mode", "video"),
        "height": msg.get("height"),
        "audioFormat": msg.get("audioFormat"),
        "audioQuality": msg.get("audioQuality"),
        "subtitles": msg.get("subtitles"),
        "playlist": bool(msg.get("playlist")),
        "title": msg.get("title"),
        "videoId": msg.get("videoId"),
    }
    if job["height"] in ("best", "", 0):
        job["height"] = None
    common.write_json_atomic(os.path.join(common.JOBS_DIR, job_id + ".json"), job)
    spawn_worker(job_id)
    return {"ok": True, "job": public_job(job)}


def job_path(job_id: str) -> str:
    return os.path.join(common.JOBS_DIR, os.path.basename(job_id) + ".json")


def cancel_job(job_id: str) -> dict:
    p = job_path(job_id)
    j = common.read_json(p)
    if not j:
        return {"error": "Unknown job"}
    j["cancelRequested"] = True
    if j.get("status") in ACTIVE:
        common.write_json_atomic(p, j)
        pid = j.get("pid")
        # Give the worker a moment to stop cleanly, then kill its process group (ffmpeg too).
        def killer():
            time.sleep(2)
            cur = common.read_json(p) or {}
            if cur.get("status") in ACTIVE and _alive(pid):
                with contextlib.suppress(OSError, ValueError):
                    os.killpg(os.getpgid(int(pid)), signal.SIGTERM)
                cur.update(status="cancelled", stage="cancelled")
                common.write_json_atomic(p, cur)
        threading.Thread(target=killer, daemon=True).start()
    return {"ok": True}


def retry_job(job_id: str) -> dict:
    j = common.read_json(job_path(job_id))
    if not j:
        return {"error": "Unknown job"}
    keys = ("url", "mode", "height", "audioFormat", "audioQuality", "subtitles", "playlist", "title", "videoId")
    remove_job(job_id)
    return start_job({k: j.get(k) for k in keys})


def remove_job(job_id: str) -> dict:
    with contextlib.suppress(OSError):
        os.remove(job_path(job_id))
    return {"ok": True}


def clear_finished() -> dict:
    for j in list_jobs(10_000):
        if j.get("status") in FINISHED:
            remove_job(j["id"])
    return {"ok": True}


# ---------- info ----------

def get_info(url: str, video_id: str | None) -> dict:
    cache = os.path.join(common.CACHE_DIR, (video_id or uuid.uuid5(uuid.NAMESPACE_URL, url).hex) + ".json")
    c = common.read_json(cache)
    if c and time.time() - c.get("_at", 0) < INFO_TTL:
        return c
    script = os.path.join(common.HOST_DIR, "info.py")
    data = None
    for attempt in range(3):
        args = [common.VENV_PY, script, url]
        if attempt == 2 and common.load_config().get("useCookies", True):
            args.append("--cookies")
        res = subprocess.run(args, capture_output=True, text=True, timeout=120)
        try:
            data = json.loads(res.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            data = {"error": (res.stderr or "Unknown error")[-400:]}
        if "error" not in data:
            break
        err = data["error"].lower()
        if "unavailable" in err or "does not exist" in err:
            break
        if attempt == 0:
            common.update_ytdlp(force=True)  # self-heal: YouTube may have changed
    if data and "error" not in data:
        data["_at"] = time.time()
        common.write_json_atomic(cache, data)
        _prune_info_cache()
    return data or {"error": "Unknown error"}


def _prune_info_cache() -> None:
    """Drop expired quality lookups so the cache folder doesn't grow forever."""
    cutoff = time.time() - INFO_TTL
    for p in glob.glob(os.path.join(common.CACHE_DIR, "*.json")):
        with contextlib.suppress(OSError):
            if os.path.getmtime(p) < cutoff:
                os.remove(p)


# ---------- misc ----------

def choose_folder() -> dict:
    cfg = common.load_config()
    start = common.download_dir(cfg)
    script = (f'POSIX path of (choose folder with prompt "Choose where YT Downloader saves files" '
              f'default location (POSIX file "{start}"))')
    res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=300)
    path = res.stdout.strip()
    if res.returncode != 0 or not path:
        return {"ok": False}
    cfg = common.save_config({"downloadDir": path.rstrip("/")})
    return {"ok": True, "config": cfg}


def reveal(path: str | None, open_file: bool = False) -> dict:
    if not path:
        path = common.download_dir(common.load_config())
        open_file = True
    if not os.path.exists(path):
        # File may have a different extension after conversion; reveal the folder instead.
        path = os.path.dirname(path) if os.path.isdir(os.path.dirname(path)) else common.download_dir(common.load_config())
        open_file = True
    subprocess.Popen(["open", path] if open_file else ["open", "-R", path])
    return {"ok": True}


def status() -> dict:
    cfg = common.load_config()
    # Opportunistic background update once a day so fixes arrive before you need them.
    if time.time() - cfg.get("lastUpdate", 0) > 24 * 3600:
        subprocess.Popen([common.VENV_PY, "-c", "import common; common.update_ytdlp()"], cwd=common.HOST_DIR,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    return {
        "ok": True, "version": common.VERSION, "ytdlp": common.ytdlp_version(),
        "ffmpeg": bool(common.ffmpeg_path()), "jsRuntimes": list(common.js_runtimes().keys()),
        "config": cfg,
    }


def handle(msg: dict) -> dict:
    t = msg.get("type")
    if t == "ping":
        return status()
    if t == "info":
        return get_info(msg["url"], msg.get("videoId"))
    if t == "download":
        return start_job(msg)
    if t == "cancel":
        return cancel_job(msg["id"])
    if t == "retry":
        return retry_job(msg["id"])
    if t == "remove":
        return remove_job(msg["id"])
    if t == "clear":
        return clear_finished()
    if t == "reveal":
        return reveal(msg.get("path"), bool(msg.get("open")))
    if t == "chooseFolder":
        return choose_folder()
    if t == "getConfig":
        return {"config": common.load_config()}
    if t == "setConfig":
        return {"config": common.save_config(msg.get("config") or {})}
    if t == "update":
        return common.update_ytdlp(force=True)
    if t == "subscribe":
        _subscribed.set()
        return {"ok": True}
    return {"error": f"Unknown message type {t!r}"}


def pusher() -> None:
    """Stream job changes to the extension: every 0.5 s while downloading, every 2 s when idle."""
    _subscribed.wait()
    last = None
    while True:
        jobs = list_jobs()
        blob = json.dumps(jobs, sort_keys=True)
        if blob != last:
            last = blob
            send({"type": "jobs", "jobs": jobs})
        active = any(j.get("status") in ACTIVE for j in jobs)
        time.sleep(0.5 if active else 2)


def main() -> None:
    threading.Thread(target=pusher, daemon=True).start()
    workers: list[threading.Thread] = []
    while True:
        try:
            msg = read()
        except (ValueError, OSError):
            break
        if msg is None:
            break
        rid = msg.get("rid")

        def work(m=msg, r=rid):
            try:
                out = handle(m)
            except Exception as e:  # noqa: BLE001
                common.log("host error", m.get("type"), repr(e))
                out = {"error": str(e)[:400]}
            if r is not None:
                out["rid"] = r
            send(out)

        # Slow calls (info, update, folder picker) must not block the port.
        th = threading.Thread(target=work, daemon=True)
        th.start()
        workers.append(th)
    # stdin closed: finish in-flight replies. Download workers are detached and keep running.
    for th in workers:
        th.join(timeout=150)


if __name__ == "__main__":
    main()
