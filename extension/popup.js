// Toolbar popup: download queue, quick download for the current tab, settings and health.

const { isActive, escapeHtml, fmtSize, progress, INSTALL_HINT } = YTD;
const $ = (sel) => document.querySelector(sel);
const DEFAULT_CONFIG = { defaultQuality: "best", audioFormat: "mp3" }; // until the helper answers

let jobs = [];
let config = { ...DEFAULT_CONFIG };

function host(msg) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ to: "host", ...msg }, (r) =>
      resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r || {})));
}

// ---------- tabs ----------
document.querySelectorAll("nav button").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((t) => t.classList.toggle("on", t === tab));
    for (const id of ["queue", "settings"]) $(`#${id}`).hidden = id !== tab.dataset.tab;
    if (tab.dataset.tab === "settings") loadStatus();
  }));

// ---------- queue ----------
const port = chrome.runtime.connect({ name: "popup" });
port.onMessage.addListener((m) => {
  if (m.type === "jobs") { jobs = m.jobs || []; renderJobs(); }
});

function statusText(job) {
  if (isActive(job)) {
    const p = progress(job);
    return job.status === "running" && job.total ? `${p.text} · ${fmtSize(job.downloaded)} of ${fmtSize(job.total)}` : p.text;
  }
  return { done: "Saved", cancelled: "Cancelled", error: `Failed: ${job.error || "unknown error"}` }[job.status] || job.status;
}

function kindLabel(job) {
  if (job.playlist) return job.mode === "audio" ? "Playlist · audio" : "Playlist · video";
  if (job.mode === "audio") return (job.audioFormat || config.audioFormat || "mp3").toUpperCase();
  if (job.mode === "thumbnail") return "Thumbnail";
  return job.height ? `${job.height}p` : "Best";
}

function renderJobs() {
  $("#empty").hidden = jobs.length > 0;
  $("#jobs").innerHTML = jobs.map((job) => {
    const id = escapeHtml(job.id);
    const action = (name, label) => `<button class="link" data-do="${name}" data-id="${id}">${label}</button>`;
    const actions = isActive(job) ? [action("cancel", "Cancel")]
      : job.status === "done" ? [action("open", "Open"), action("reveal", "Show")]
        : [action("retry", "Retry"), action("remove", "Remove")];
    const name = escapeHtml(job.title || job.url);
    const text = statusText(job);
    return `<li class="${escapeHtml(job.status)}">
      <div class="t" title="${name}">${name}</div>
      <div class="m"><span>${escapeHtml(kindLabel(job))}</span><span class="s" title="${escapeHtml(text)}">${escapeHtml(text.slice(0, 70))}</span><span class="acts">${actions.join("")}</span></div>
      ${isActive(job) ? `<div class="bar"><i style="width:${progress(job).pct}%"></i></div>` : ""}
    </li>`;
  }).join("");
}

$("#jobs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-do]");
  if (!btn) return;
  const job = jobs.find((j) => j.id === btn.dataset.id);
  const act = btn.dataset.do;
  if (act === "open") host({ type: "reveal", path: job?.filepath, open: true });
  else if (act === "reveal") host({ type: "reveal", path: job?.filepath });
  else host({ type: act, id: btn.dataset.id });
});
$("#openFolder").addEventListener("click", () => host({ type: "reveal" }));
$("#clear").addEventListener("click", () => host({ type: "clear" }));

// Download the current tab from here too (works even if the page button is missing).
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const url = YTD.canonicalUrl(tab?.url || "");
  if (!YTD.parseVideo(url).id) return;
  const title = tab.title?.replace(/ - YouTube$/, "");
  $("#current").hidden = false;
  $("#dlNow").onclick = () => {
    const height = config.defaultQuality === "best" ? null : Number(config.defaultQuality) || null;
    host({ type: "download", url, mode: "video", height, title });
  };
  $("#dlAudio").onclick = () => host({ type: "download", url, mode: "audio", title });
});

// ---------- settings ----------
function applyConfig(next) {
  config = { ...DEFAULT_CONFIG, ...next };
  chrome.storage.local.set({ config });
  $("#dir").textContent = config.downloadDir;
  document.querySelectorAll("[data-key]").forEach((el) => {
    const value = config[el.dataset.key];
    if (el.type === "checkbox") el.checked = !!value; else el.value = String(value);
  });
}

document.querySelectorAll("[data-key]").forEach((el) =>
  el.addEventListener("change", async () => {
    const key = el.dataset.key;
    const r = await host({ type: "setConfig", config: { [key]: el.type === "checkbox" ? el.checked : el.value } });
    if (r.config) applyConfig(r.config);
    // A new default should win over the quality last picked from the page menu.
    if (key === "defaultQuality") chrome.storage.local.remove("lastChoice");
  }));

$("#chooseDir").addEventListener("click", async () => {
  const r = await host({ type: "chooseFolder" });
  if (r.config) applyConfig(r.config);
});

$("#update").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Updating…";
  const r = await host({ type: "update" });
  btn.disabled = false;
  btn.textContent = r.error ? "Update failed" : r.updated ? `Updated to ${r.version}` : `Up to date (${r.version})`;
  loadStatus();
});

async function loadStatus() {
  const r = await host({ type: "ping" });
  if (r.error) return showHostMissing(r.error);
  $("#hVer").textContent = r.version;
  $("#hYt").textContent = r.ytdlp;
  $("#hFf").textContent = r.ffmpeg ? "OK" : "Missing";
  $("#hJs").textContent = r.jsRuntimes?.join(", ") || "Missing";
  applyConfig(r.config);
}

function showHostMissing(error) {
  const warn = $("#hostWarn");
  warn.hidden = false;
  warn.innerHTML = `Mac helper not connected (${escapeHtml(error)}).<br>${INSTALL_HINT}, then reopen this popup.`;
}

loadStatus();
