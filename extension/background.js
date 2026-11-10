// YT Downloader – service worker.
// Owns one native-messaging port to the Mac helper, routes requests by id,
// and broadcasts job progress to every open YouTube tab and the popup.

importScripts("shared/ytd.js");

const HOST = "com.ytdownloader.host";
const IDLE_DISCONNECT_MS = 60000;
const CALL_TIMEOUT_MS = 180000;
const YT_TABS = ["https://www.youtube.com/*", "https://m.youtube.com/*"];
const YT_LINKS = [...YT_TABS, "https://youtu.be/*", "https://music.youtube.com/*"];
let port = null;
let rid = 0;
const pending = new Map();
const popupPorts = new Set(); // an open popup gets job updates and keeps the helper running
let lastJobs = [];
let idleTimer = null;
let hostError = null;

function connect() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    hostError = String(e);
    return null;
  }
  hostError = null;
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    hostError = chrome.runtime.lastError?.message || "Helper disconnected";
    port = null;
    rejectPending(hostError);
  });
  port.postMessage({ type: "subscribe", rid: ++rid });
  return port;
}

function rejectPending(reason) {
  for (const [, p] of pending) p.reject(new Error(reason));
  pending.clear();
}

// Our own disconnect() doesn't fire onDisconnect, so settle in-flight calls here.
function dropPort(reason) {
  port?.disconnect();
  port = null;
  rejectPending(reason);
}

function onHostMessage(msg) {
  if (msg.type === "jobs" && msg.rid === undefined) {
    lastJobs = msg.jobs || [];
    broadcast({ type: "jobs", jobs: lastJobs });
    updateBadge();
    scheduleIdle();
    return;
  }
  const p = pending.get(msg.rid);
  if (p) {
    pending.delete(msg.rid);
    p.resolve(msg);
    scheduleIdle();
  }
}

function call(msg, timeoutMs = CALL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const p = connect();
    if (!p) return reject(new Error(hostError || "Helper not installed"));
    const id = ++rid;
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Helper timed out"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (m) => { clearTimeout(t); resolve(m); },
      reject: (e) => { clearTimeout(t); reject(e); },
    });
    p.postMessage({ ...msg, rid: id });
  });
}

const activeCount = () => lastJobs.filter(YTD.isActive).length;

// Keep the helper running only while something needs it: a download, an open popup or an
// in-flight request. YouTube tabs alone don't, so an idle browser costs no helper process.
const helperNeeded = () => activeCount() > 0 || popupPorts.size > 0 || pending.size > 0;

function scheduleIdle() {
  clearTimeout(idleTimer);
  if (helperNeeded()) return;
  idleTimer = setTimeout(() => {
    if (!helperNeeded() && port) dropPort("Helper idle");
  }, IDLE_DISCONNECT_MS);
}

// Job updates go to the popup over its port and to YouTube tabs as one-off messages, so idle tabs
// hold no connection and never keep this worker (or the helper) awake.
function broadcast(msg) {
  for (const p of popupPorts) {
    try { p.postMessage(msg); } catch { popupPorts.delete(p); }
  }
  chrome.tabs.query({ url: YT_TABS }, (tabs) => {
    for (const tab of tabs || []) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  });
}

function updateBadge() {
  const n = activeCount();
  chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
  chrome.action.setBadgeText({ text: n ? String(n) : "" });
}

chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== "popup") return;
  popupPorts.add(p);
  clearTimeout(idleTimer);
  connect();
  p.postMessage({ type: "jobs", jobs: lastJobs });
  p.onDisconnect.addListener(() => {
    popupPorts.delete(p);
    scheduleIdle();
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.to === "bg") {
    if (msg.type === "openPopup") {
      chrome.action.openPopup().catch(() => chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") }));
    } else if (msg.type === "jobs") {
      sendResponse({ jobs: lastJobs }); // a tab asking for current state on load
    }
    return;
  }
  if (msg?.to !== "host") return;
  const { to, ...body } = msg;
  call(body)
    .then((r) => sendResponse(r))
    .catch((e) => sendResponse({ error: e.message, hostMissing: YTD.isHostMissing(e.message) }));
  return true;
});

// ---------- right-click menu & keyboard shortcuts (work even if YouTube's page layout changes) ----------

chrome.runtime.onInstalled.addListener(() => {
  refreshOpenTabs();
  chrome.contextMenus.removeAll(() => {
    for (const ctx of [["link", "targetUrlPatterns"], ["page", "documentUrlPatterns"]]) {
      const [c, key] = ctx;
      chrome.contextMenus.create({ id: `video-${c}`, title: "Download video (best)", contexts: [c], [key]: YT_LINKS });
      chrome.contextMenus.create({ id: `audio-${c}`, title: "Download audio (MP3)", contexts: [c], [key]: YT_LINKS });
    }
  });
});

// Tabs opened before an install/reload still run the old content script (or none). Inject the
// current one (same files as the manifest); it takes over from any stale copy, so no refresh is needed.
async function refreshOpenTabs() {
  const files = chrome.runtime.getManifest().content_scripts[0].js;
  const tabs = await chrome.tabs.query({ url: YT_TABS });
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files }).catch(() => {});
  }
}

async function quickDownload(url, mode, tabId) {
  if (!url) return;
  const r = await call({ type: "download", url: YTD.canonicalUrl(url), mode }).catch((e) => ({ error: e.message }));
  if (r.error && tabId) chrome.tabs.sendMessage(tabId, { type: "toast", text: r.error }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const [mode] = info.menuItemId.split("-");
  quickDownload(info.linkUrl || info.pageUrl, mode, tab?.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/youtube\.com|youtu\.be/.test(tab.url)) return;
  quickDownload(tab.url, command === "download-audio" ? "audio" : "video", tab.id);
});
