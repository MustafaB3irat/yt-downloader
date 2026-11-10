"""Print available qualities for a URL as JSON. Usage: info.py <url> [--cookies]"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402


def main() -> None:
    import yt_dlp

    url = sys.argv[1]
    cfg = common.load_config()
    opts = {
        "quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True,
        "js_runtimes": common.js_runtimes(),
    }
    if "--cookies" in sys.argv:
        opts["cookiesfrombrowser"] = (cfg.get("cookieBrowser") or "chrome",)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    duration = info.get("duration") or 0
    best_audio = 0
    heights: dict[int, dict] = {}
    for f in info.get("formats") or []:
        if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none"):
            best_audio = max(best_audio, f.get("filesize") or f.get("filesize_approx") or 0)
    for f in info.get("formats") or []:
        h = f.get("height")
        if not h or f.get("vcodec") in (None, "none") or "storyboard" in (f.get("format_note") or ""):
            continue
        # Use the shorter side so vertical Shorts report 1080p, not 1920p.
        w = f.get("width") or h
        label = min(w, h)
        size = (f.get("filesize") or f.get("filesize_approx") or 0)
        if f.get("acodec") in (None, "none"):
            size += best_audio
        cur = heights.get(label)
        cand = {"height": label, "fps": f.get("fps") or 30, "hdr": (f.get("dynamic_range") or "SDR") != "SDR",
                "size": size}
        if not cur or (cand["fps"], cand["size"]) > (cur["fps"], cur["size"]):
            heights[label] = cand

    print(json.dumps({
        "id": info.get("id"),
        "title": info.get("title"),
        "duration": duration,
        "thumbnail": info.get("thumbnail"),
        "isLive": bool(info.get("is_live")),
        "qualities": sorted(heights.values(), key=lambda q: -q["height"]),
        "audioSize": best_audio,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e).replace("ERROR: ", "")[:500]}))
        sys.exit(1)
