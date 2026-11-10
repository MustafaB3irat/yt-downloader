#!/bin/bash
# Removes the helper, its schedule and Chrome registration. Your downloaded files are not touched.
set -u
LABEL="com.ytdownloader.maintain"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
find "$HOME/Library/Application Support" -maxdepth 4 -name "com.ytdownloader.host.json" -path "*NativeMessagingHosts*" -delete 2>/dev/null
[ -f /Library/Google/Chrome/NativeMessagingHosts/com.ytdownloader.host.json ] && sudo rm -f /Library/Google/Chrome/NativeMessagingHosts/com.ytdownloader.host.json
rm -rf "$HOME/Library/Application Support/YTDownloader"
echo "Removed. Also remove the extension from chrome://extensions."
