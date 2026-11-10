#!/bin/bash
# Runs daily (launchd): update yt-dlp, then prove a real YouTube extraction still works.
# Only bothers you with a notification if YouTube currently breaks it.
HOST="$(cd "$(dirname "$0")/../host" && pwd)"
PY="$HOME/Library/Application Support/YTDownloader/venv/bin/python"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.deno/bin:$PATH"
echo "--- $(date)"
cd "$HOST" && "$PY" -c "import common; print(common.update_ytdlp(force=True))"
"$PY" "$HOST/info.py" "https://www.youtube.com/watch?v=jNQXAC9IVRw" > /tmp/ytd-selftest.json 2>&1
if grep -q '"qualities"' /tmp/ytd-selftest.json; then
  echo "self-test OK"
else
  echo "self-test FAILED: $(head -c 400 /tmp/ytd-selftest.json)"
  osascript -e 'display notification "YouTube changed something. yt-dlp usually ships a fix within days; this check re-runs daily and updates automatically." with title "YT Downloader: downloads may fail"'
fi
