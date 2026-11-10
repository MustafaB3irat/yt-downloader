"""Shared paths, config and helpers for the YT Downloader native host and worker."""
from __future__ import annotations

import contextlib
import json
import os
import shutil
import subprocess
import tempfile
import time

VERSION = "1.0.0"

APP_DIR = os.path.expanduser("~/Library/Application Support/YTDownloader")
JOBS_DIR = os.path.join(APP_DIR, "jobs")
CACHE_DIR = os.path.join(APP_DIR, "cache")
LOG_DIR = os.path.join(APP_DIR, "logs")
CONFIG_PATH = os.path.join(APP_DIR, "config.json")
VENV_PY = os.path.join(APP_DIR, "venv", "bin", "python")
HOST_DIR = os.path.dirname(os.path.abspath(__file__))

for _d in (APP_DIR, JOBS_DIR, CACHE_DIR, LOG_DIR):
    os.makedirs(_d, exist_ok=True)

# Chrome starts the host with a minimal PATH; make Homebrew tools visible.
_EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.deno/bin")]
os.environ["PATH"] = os.pathsep.join(_EXTRA_PATH + [os.environ.get("PATH", "/usr/bin:/bin")])

DEFAULT_CONFIG = {
    "downloadDir": "~/Downloads/YouTube",
    "defaultQuality": "best",       # "best" or a height like 1080
    "audioFormat": "mp3",           # mp3 | m4a
    "audioQuality": "320",          # kbps for mp3
    "preferCompatible": True,       # prefer H.264/AAC when the resolution is the same
    "subtitles": "off",             # off | srt | embed
    "subtitleLangs": "en.*,orig",
    "embedThumbnail": True,
    "useCookies": True,             # retry with Chrome cookies for age/bot/member checks
    "cookieBrowser": "chrome",
    "maxConcurrent": 3,
    "updateChannel": "nightly",     # nightly | stable
    "hoverMenu": False,
    "notifications": True,
    "lastUpdate": 0,
}


def log(*parts) -> None:
    try:
        with open(os.path.join(LOG_DIR, "ytd.log"), "a") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(p) for p in parts) + "\n")
    except OSError:
        pass


def write_json_atomic(path: str, data) -> None:
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def read_json(path: str, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(read_json(CONFIG_PATH, {}) or {})
    return cfg


def save_config(updates: dict) -> dict:
    cfg = load_config()
    for k, v in updates.items():
        if k in DEFAULT_CONFIG:
            cfg[k] = v
    write_json_atomic(CONFIG_PATH, cfg)
    return cfg


def download_dir(cfg: dict) -> str:
    d = os.path.expanduser(cfg.get("downloadDir") or DEFAULT_CONFIG["downloadDir"])
    os.makedirs(d, exist_ok=True)
    return d


def js_runtimes() -> dict:
    """YouTube needs a JS runtime to solve its player challenges. Prefer deno, fall back to node."""
    rts = {}
    deno = shutil.which("deno")
    node = shutil.which("node")
    if deno:
        rts["deno"] = {"path": deno}
    if node:
        rts["node"] = {"path": node}
    return rts


def ffmpeg_path() -> str | None:
    return shutil.which("ffmpeg")


def notify(title: str, message: str) -> None:
    if not load_config().get("notifications", True):
        return
    def esc(s):
        return s.replace("\\", "\\\\").replace('"', '\\"')
    with contextlib.suppress(OSError):
        subprocess.Popen(
            ["osascript", "-e", f'display notification "{esc(message)}" with title "{esc(title)}"'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )


def ytdlp_version() -> str:
    try:
        out = subprocess.run([VENV_PY, "-c", "import yt_dlp.version as v;print(v.__version__)"],
                             capture_output=True, text=True, timeout=20)
        return out.stdout.strip() or "missing"
    except Exception:
        return "missing"


def update_ytdlp(force: bool = False) -> dict:
    """Update yt-dlp in the venv. Nightly gets YouTube fixes days before stable."""
    cfg = load_config()
    if not force and time.time() - cfg.get("lastUpdate", 0) < 6 * 3600:
        return {"updated": False, "version": ytdlp_version(), "reason": "recent"}
    lock = os.path.join(APP_DIR, "update.lock")
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
    except FileExistsError:
        # Another process is updating; wait for it (stale lock after 5 min).
        for _ in range(150):
            if not os.path.exists(lock):
                break
            if time.time() - os.path.getmtime(lock) > 300:
                os.remove(lock)
                break
            time.sleep(2)
        return {"updated": False, "version": ytdlp_version(), "reason": "concurrent"}
    try:
        before = ytdlp_version()
        args = [VENV_PY, "-m", "pip", "install", "-q", "-U", "yt-dlp[default]"]
        if cfg.get("updateChannel", "nightly") == "nightly":
            args.insert(5, "--pre")
        res = subprocess.run(args, capture_output=True, text=True, timeout=600)
        after = ytdlp_version()
        save_config({"lastUpdate": time.time()})
        log("update", before, "->", after, res.returncode, res.stderr[-500:])
        return {"updated": before != after, "version": after, "ok": res.returncode == 0}
    finally:
        with contextlib.suppress(OSError):
            os.remove(lock)
