#!/bin/bash
# YT Downloader installer: sets up the Mac helper (yt-dlp + ffmpeg) and connects it to Chrome.
# Safe to re-run any time (also after moving this folder).
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Library/Application Support/YTDownloader"
HOST_NAME="com.ytdownloader.host"
LABEL="com.ytdownloader.maintain"

say() { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!!\033[0m %s\n" "$*"; }

# 1. Tools
if ! command -v brew >/dev/null; then
  warn "Homebrew is required: https://brew.sh"; exit 1
fi
PY=""
for c in /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if [ -x "$c" ] && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then say "Installing Python"; brew install python; PY="$(brew --prefix)/bin/python3"; fi
command -v ffmpeg >/dev/null || { say "Installing ffmpeg"; brew install ffmpeg; }
# YouTube requires a JavaScript runtime to solve its player challenges. deno is yt-dlp's preferred one.
command -v deno >/dev/null || { say "Installing deno (JS runtime for YouTube challenges)"; brew install deno || warn "deno install failed; will use node if present"; }

# 2. Python venv with yt-dlp (nightly gets YouTube fixes first)
mkdir -p "$APP"
if [ ! -x "$APP/venv/bin/python" ]; then say "Creating Python environment"; "$PY" -m venv "$APP/venv"; fi
say "Installing/updating yt-dlp"
"$APP/venv/bin/python" -m pip install -q -U pip
"$APP/venv/bin/python" -m pip install -q -U --pre "yt-dlp[default]"
chmod +x "$REPO/host/ytd-host" "$REPO/scripts/"*.sh

# 3. Register the native messaging host with every Chromium browser that's installed
EXT_ID="$("$APP/venv/bin/python" - "$REPO/extension/manifest.json" <<'PY'
import base64, hashlib, json, sys
key = json.load(open(sys.argv[1]))["key"]
h = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in h))
PY
)"
MANIFEST=$(cat <<JSON
{
  "name": "$HOST_NAME",
  "description": "YT Downloader helper",
  "path": "$REPO/host/ytd-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
)
registered=0
for base in "Google/Chrome" "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Arc/User Data" "Vivaldi"; do
  dir="$HOME/Library/Application Support/$base"
  [ -d "$dir" ] || continue
  if mkdir -p "$dir/NativeMessagingHosts" 2>/dev/null && printf "%s\n" "$MANIFEST" > "$dir/NativeMessagingHosts/$HOST_NAME.json" 2>/dev/null; then
    say "Connected to $base"; registered=1
  else
    warn "macOS blocked writing to $base. Give Terminal Full Disk Access or run: sudo $0 --system"
  fi
done
if [ "${1:-}" = "--system" ] || [ $registered -eq 0 ]; then
  say "Registering system-wide (needs your password)"
  sudo mkdir -p "/Library/Google/Chrome/NativeMessagingHosts"
  printf "%s\n" "$MANIFEST" | sudo tee "/Library/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json" >/dev/null
fi

# 4. Daily self-maintenance: update yt-dlp + health check (notifies you only if something is broken)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPO/scripts/maintain.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>11</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$APP/logs/maintain.log</string>
  <key>StandardErrorPath</key><string>$APP/logs/maintain.log</string>
</dict></plist>
PL
mkdir -p "$APP/logs"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || warn "Could not schedule daily maintenance"

say "Helper installed. Extension ID: $EXT_ID"
echo
echo "Last step (one time):"
echo "  1. Open chrome://extensions and turn on Developer mode (top right)"
echo "  2. Click 'Load unpacked' and pick: $REPO/extension"
echo "  3. Refresh any open YouTube tab"
echo
echo "Check health any time:  $REPO/scripts/doctor.sh"
