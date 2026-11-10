#!/bin/bash
# Health check: prints what's installed and does a live test against YouTube.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Library/Application Support/YTDownloader"
PY="$APP/venv/bin/python"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.deno/bin:$PATH"
ok() { printf "  \033[32m✓\033[0m %s\n" "$*"; }
bad() { printf "  \033[31m✗\033[0m %s\n" "$*"; FAIL=1; }
FAIL=0
echo "YT Downloader doctor"
if [ -x "$PY" ]; then ok "Python env: $("$PY" --version)"; else bad "Python env missing (run install.sh)"; fi
if v=$("$PY" -c "import yt_dlp.version as v;print(v.__version__)" 2>/dev/null); then ok "yt-dlp $v"; else bad "yt-dlp missing"; fi
if command -v ffmpeg >/dev/null; then ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"; else bad "ffmpeg missing (brew install ffmpeg)"; fi
if command -v deno >/dev/null; then ok "deno $(deno --version | head -1 | awk '{print $2}')"; elif command -v node >/dev/null; then ok "node $(node --version) (deno preferred: brew install deno)"; else bad "No JS runtime (brew install deno)"; fi
found=0
for f in "$HOME/Library/Application Support/"*/NativeMessagingHosts/com.ytdownloader.host.json "$HOME/Library/Application Support/"*/*/NativeMessagingHosts/com.ytdownloader.host.json /Library/Google/Chrome/NativeMessagingHosts/com.ytdownloader.host.json; do
  [ -f "$f" ] && { ok "Registered: $f"; found=1; }
done 2>/dev/null
[ $found -eq 1 ] || bad "Not registered with Chrome (run install.sh)"
if launchctl print "gui/$(id -u)/com.ytdownloader.maintain" >/dev/null 2>&1; then ok "Daily auto-update scheduled"; else bad "Daily auto-update not scheduled (run install.sh)"; fi
echo "  … live test against YouTube"
out=$("$PY" "$REPO/host/info.py" "https://www.youtube.com/watch?v=jNQXAC9IVRw" 2>&1)
if echo "$out" | grep -q '"qualities"'; then ok "YouTube extraction works"; else bad "YouTube extraction failed: $(echo "$out" | head -c 300)"; fi
exit $FAIL
