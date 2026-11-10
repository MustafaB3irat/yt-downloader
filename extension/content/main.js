// YT Downloader – YouTube page UI entry point.
// Mounts the Download row (watch page), the round button (Shorts) or a floating fallback,
// keeps them in sync with the helper's jobs, and handles every click.
// Load order (manifest): shared/ytd.js, content/icons.js, styles.js, page.js, menu.js, status.js, main.js.

(() => {
  const { CSS, icon, page, menu: Menu, status: Status, isActive, isHostMissing, resolutionLabel, INSTALL_HINT } = YTD;

  const TICK_MS = 1000;            // re-check placement (YouTube is a single-page app)
  const FALLBACK_DELAY_MS = 10000; // how long to wait for a page anchor before floating the button
  const HOVER_INTENT_MS = 200;     // hover this long before looking up qualities
  const TOAST_MS = 5000;
  const INFO_TTL_MS = 30 * 60 * 1000; // quality lists change rarely, but sizes/formats can
  const INFO_CACHE_MAX = 20;
  const UI_TAGS = ["ytd-dl-row", "ytd-dl-short", "ytd-dl-float", "ytd-dl-toast"];

  // ---------- lifecycle ----------
  // When the extension reloads, background.js injects a fresh copy into open YouTube tabs. The new
  // copy fires TAKEOVER and the old one removes its UI and listeners, so stale code never lingers.
  const TAKEOVER = "ytd-dl-takeover";
  const removeUi = () => document.querySelectorAll(UI_TAGS.join(",")).forEach((el) => el.remove());
  document.dispatchEvent(new CustomEvent(TAKEOVER));
  removeUi();

  const life = new AbortController();
  const alive = () => !life.signal.aborted;
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: life.signal });
  const orphaned = () => !chrome.runtime?.id; // extension reloaded or removed under us
  let timer = 0;

  function teardown() {
    if (!alive()) return;
    life.abort();
    clearInterval(timer);
    removeUi();
  }
  on(document, TAKEOVER, teardown);

  // ---------- state ----------
  let jobs = [];
  let config = { defaultQuality: "best", audioFormat: "mp3", audioQuality: "320", hoverMenu: false };
  let lastChoice = null;        // remembered menu pick, used by the main button
  const dismissed = new Set();  // job ids whose status pill the user closed
  const infoCache = new Map();  // videoId -> { at, promise }, oldest first
  const ui = { row: null, short: null, float: null, toast: null };
  let lastUrl = "";
  let missSince = 0;

  // ---------- messaging ----------
  // Job updates arrive as messages from the service worker; tabs hold no open connection.
  function setJobs(list) {
    jobs = list || [];
    for (const id of dismissed) if (!jobs.some((j) => j.id === id)) dismissed.delete(id);
    render();
  }

  function hostCall(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ to: "host", ...msg }, (r) => {
          resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r || { error: "No response" });
        });
      } catch {
        resolve({ error: "Extension was updated. Refresh the page." });
      }
    });
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (!alive()) return;
    if (m.type === "jobs") setJobs(m.jobs);
    else if (m.type === "toast") toast(YTD.escapeHtml(m.text));
  });

  // ---------- widgets ----------
  function makeHost(tag) {
    const el = document.createElement(tag);
    el.attachShadow({ mode: "open" }).innerHTML = `<style>${CSS}</style><div class="root"></div>`;
    el.setAttribute("data-theme", page.theme());
    return el;
  }
  const rootOf = (host) => host.shadowRoot.querySelector(".root");

  function rowHTML() {
    return `
      <div class="row">
        <div class="group">
          <button class="dl" data-act="quick"><i class="fill"></i><span class="ic">${icon("download", 18)}</span><span class="lbl">Download</span><span class="chip"></span></button>
          <div class="sep"></div>
          <button class="more" data-act="menu" title="More options" aria-haspopup="menu" aria-expanded="false">${icon("more", 18)}</button>
          <div class="menu" role="menu"></div>
        </div>
        <button class="icon" data-act="folder" title="Open downloads folder">${icon("folder")}</button>
        <div class="status"></div>
      </div>`;
  }

  function mountWatch() {
    const id = page.videoId();
    if (ui.row?.isConnected && ui.row.dataset.vid === id) return;
    ui.row?.remove();
    const anchor = page.watchAnchor();
    if (!anchor) return;
    ui.row = makeHost("ytd-dl-row");
    ui.row.style.cssText = "display:block;margin:8px 0 0";
    ui.row.dataset.vid = id;
    rootOf(ui.row).innerHTML = rowHTML();
    wireRow(ui.row.shadowRoot);
    anchor.parent.insertBefore(ui.row, anchor.before);
    removeFloat();
  }

  function mountShort() {
    const id = page.videoId();
    if (ui.short?.isConnected && ui.short.dataset.vid === id && page.visible(ui.short)) return;
    ui.short?.remove();
    const anchor = page.shortsAnchor();
    if (!anchor) return;
    ui.short = makeHost("ytd-dl-short");
    ui.short.style.display = "block";
    ui.short.dataset.vid = id;
    rootOf(ui.short).innerHTML =
      `<div class="short"><button title="Download Short (right-click for MP3)"><i class="ring"></i>${icon("download", 18)}</button><div class="lbl">Download</div></div>`;
    const btn = ui.short.shadowRoot.querySelector("button");
    btn.addEventListener("click", () => startDownload({ mode: "video", height: null }));
    btn.addEventListener("contextmenu", (e) => { e.preventDefault(); startDownload({ mode: "audio" }); });
    anchor.prepend(ui.short);
    removeFloat();
  }

  function mountFloat(kind) {
    if (ui.float?.isConnected && ui.float.dataset.kind === kind) return;
    removeFloat();
    ui.float = makeHost("ytd-dl-float");
    ui.float.dataset.kind = kind;
    rootOf(ui.float).innerHTML = `<div class="float ${kind}">${rowHTML()}</div>`;
    wireRow(ui.float.shadowRoot);
    document.body.appendChild(ui.float);
  }
  function removeFloat() { ui.float?.remove(); ui.float = null; }

  const rowHosts = () => [ui.row, ui.float].filter(Boolean);

  function wireRow(root) {
    const menu = root.querySelector(".menu");
    const group = root.querySelector(".group");
    root.querySelector('[data-act="quick"]').addEventListener("click", () => startDownload(currentChoice()));
    root.querySelector('[data-act="menu"]').addEventListener("click", () => toggleMenu(root, !menu.classList.contains("open")));
    root.querySelector('[data-act="folder"]').addEventListener("click", () => hostCall({ type: "reveal" }));

    // Look up qualities on a deliberate hover only, so passing the mouse over costs nothing.
    let intentTimer;
    let closeTimer;
    group.addEventListener("mouseenter", () => {
      intentTimer = setTimeout(fetchInfo, HOVER_INTENT_MS);
      if (config.hoverMenu) { clearTimeout(closeTimer); toggleMenu(root, true); }
    });
    group.addEventListener("mouseleave", () => {
      clearTimeout(intentTimer);
      if (config.hoverMenu) closeTimer = setTimeout(() => toggleMenu(root, false), 250);
    });

    menu.addEventListener("click", (e) => {
      const foot = e.target.closest("[data-foot]")?.dataset.foot;
      if (foot === "folder") return hostCall({ type: "reveal" });
      if (foot === "settings") return chrome.runtime.sendMessage({ to: "bg", type: "openPopup" });
      const el = e.target.closest("[data-mode]");
      if (!el) return;
      toggleMenu(root, false);
      const choice = Menu.choiceFrom(el);
      if (choice.mode !== "thumbnail" && !choice.subtitles && !choice.playlist) rememberChoice(choice);
      startDownload(choice);
    });

    root.querySelector(".status").addEventListener("click", (e) => {
      const el = e.target.closest("[data-do][data-job]");
      const job = el && jobs.find((j) => j.id === el.dataset.job);
      if (!job) return;
      const actions = {
        dismiss: () => { dismissed.add(job.id); render(); },
        open: () => hostCall({ type: "reveal", path: job.filepath, open: true }),
        reveal: () => hostCall({ type: "reveal", path: job.filepath }),
        cancel: () => hostCall({ type: "cancel", id: job.id }),
        retry: () => hostCall({ type: "retry", id: job.id }),
      };
      actions[el.dataset.do]?.();
    });
  }

  // ---------- menu ----------
  function toggleMenu(root, open) {
    const menu = root.querySelector(".menu");
    if (open) Menu.place(menu, root.querySelector(".group"));
    menu.classList.toggle("open", open);
    root.querySelector('[data-act="menu"]').setAttribute("aria-expanded", String(open));
    if (open) fillMenu(menu);
  }

  // Close on any press outside the Download/⋮ group. pointerdown on window (capture) runs before
  // YouTube's handlers, which swallow plain clicks on the player. The rest of the row counts as outside.
  function closeMenus(path = []) {
    for (const host of rowHosts()) {
      if (!path.includes(host.shadowRoot.querySelector(".group"))) toggleMenu(host.shadowRoot, false);
    }
  }
  on(window, "pointerdown", (e) => closeMenus(e.composedPath()), { capture: true });
  on(window, "blur", () => closeMenus()); // press landed in an iframe (chat, ads)
  on(document, "yt-navigate-start", () => closeMenus());
  on(document, "keydown", (e) => { if (e.key === "Escape") closeMenus(); });

  async function fillMenu(menu) {
    const id = page.videoId();
    menu.innerHTML = Menu.shell({
      videoId: id,
      title: page.title(),
      saveDir: String(config.downloadDir || "~/Downloads/YouTube").replace(/^\/Users\/[^/]+/, "~"),
      audioQuality: config.audioQuality || "320",
      audioFormat: config.audioFormat || "mp3",
      playlist: !!page.playlistId(),
      isSelected,
    });
    const info = await fetchInfo();
    if (page.videoId() !== id || !menu.classList.contains("open")) return;
    if (info?.hostMissing) { menu.classList.remove("open"); return helperMissing(); }
    menu.querySelector(".qs").innerHTML = Menu.qualityRows(info?.qualities, isSelected);
    const sizeEl = menu.querySelector("[data-audio-size]");
    if (sizeEl && info?.duration) sizeEl.textContent = Menu.audioSize(config.audioQuality || 320, info.duration);
  }

  function fetchInfo() {
    const id = page.videoId();
    if (!id) return Promise.resolve(null);
    const hit = infoCache.get(id);
    if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.promise;
    const promise = hostCall({ type: "info", url: page.videoUrl(), videoId: id }).then((r) => {
      if (r.error && infoCache.get(id)?.promise === promise) infoCache.delete(id); // retry next time
      return r;
    });
    infoCache.delete(id); // re-insert so the map stays ordered oldest → newest
    infoCache.set(id, { at: Date.now(), promise });
    while (infoCache.size > INFO_CACHE_MAX) infoCache.delete(infoCache.keys().next().value);
    return promise;
  }

  // ---------- choices & downloads ----------
  function defaultChoice() {
    const height = config.defaultQuality === "best" ? null : Number(config.defaultQuality) || null;
    return { mode: "video", height };
  }
  const currentChoice = () => lastChoice || defaultChoice();

  function rememberChoice({ mode, height, audioFormat }) {
    lastChoice = { mode, height, audioFormat };
    chrome.storage.local.set({ lastChoice });
    render();
  }

  function choiceLabel() {
    const c = currentChoice();
    if (c.mode === "audio") return (c.audioFormat || config.audioFormat || "mp3").toUpperCase();
    return c.height ? resolutionLabel(c.height) : "Best";
  }

  function isSelected(mode, height, format) {
    const c = currentChoice();
    if (c.mode !== mode) return false;
    if (mode === "audio") return (c.audioFormat || config.audioFormat || "mp3") === format;
    return (c.height || null) === (height || null);
  }

  async function startDownload(choice) {
    const url = choice.playlist ? `https://www.youtube.com/playlist?list=${encodeURIComponent(page.playlistId())}` : page.videoUrl();
    if (!url) return;
    const r = await hostCall({
      type: "download", url, mode: choice.mode, height: choice.height || null,
      audioFormat: choice.audioFormat, subtitles: choice.subtitles, playlist: !!choice.playlist,
      title: choice.playlist ? null : page.title(), videoId: choice.playlist ? null : page.videoId(),
    });
    if (r.error) return r.hostMissing || isHostMissing(r.error) ? helperMissing() : toast(YTD.escapeHtml(r.error));
    if (r.job) { jobs = [r.job, ...jobs.filter((j) => j.id !== r.job.id)]; render(); }
  }

  const helperMissing = () => toast(`The Mac helper isn't installed yet. ${INSTALL_HINT}, then refresh this page.`, 9000);

  function toast(html, ms = TOAST_MS) {
    ui.toast?.remove();
    const el = makeHost("ytd-dl-toast");
    rootOf(el).innerHTML = `<div class="toast">${html}</div>`;
    document.body.appendChild(el);
    ui.toast = el;
    setTimeout(() => { el.remove(); if (ui.toast === el) ui.toast = null; }, ms);
  }

  // ---------- render loop ----------
  function render() {
    const id = page.videoId();
    const job = jobs.find((j) => j.videoId === id);
    const pillJob = job && !dismissed.has(job.id) && job.status !== "cancelled" ? job : null;
    const theme = page.theme();
    const chip = isActive(job) ? "" : choiceLabel();
    // Skip DOM work when nothing visible changed (the placement loop calls this every second).
    const sig = [theme, chip, pillJob?.id, job?.id, job?.status, job?.progress, job?.stage, job?.speed].join("|");
    const changed = (host) => host.isConnected && host.dataset.sig !== sig && ((host.dataset.sig = sig), true);
    for (const host of rowHosts()) {
      if (!changed(host)) continue;
      host.setAttribute("data-theme", theme);
      Status.renderButton(host.shadowRoot, job, chip);
      Status.renderPill(host.shadowRoot.querySelector(".status"), pillJob);
    }
    if (ui.short && changed(ui.short)) {
      ui.short.setAttribute("data-theme", theme);
      Status.renderShort(ui.short.shadowRoot, job);
    }
  }

  // Place (or re-place) widgets for whatever page YouTube is showing now.
  function tick() {
    if (!alive()) return;
    if (location.href !== lastUrl) { lastUrl = location.href; missSince = Date.now(); }
    const waitedLong = Date.now() - missSince > FALLBACK_DELAY_MS;
    const kind = page.kind();
    if (kind === "watch") {
      ui.short?.remove();
      mountWatch();
      if (!ui.row?.isConnected && page.hasWatchLayout() && waitedLong) mountFloat("watch");
    } else if (kind === "shorts") {
      ui.row?.remove();
      mountShort();
      if (!ui.short?.isConnected && waitedLong) mountFloat("shorts");
    } else {
      ui.row?.remove(); ui.short?.remove(); removeFloat();
    }
    render();
  }

  // ---------- start ----------
  // Settings live in chrome.storage (written by the popup); ask the helper only on first run.
  chrome.storage.local.get(["config", "lastChoice"], ({ config: saved, lastChoice: choice }) => {
    if (saved) config = { ...config, ...saved };
    if (choice) lastChoice = choice;
    render();
    if (!saved) {
      hostCall({ type: "getConfig" }).then((r) => {
        if (r?.config) chrome.storage.local.set({ config: r.config }); // onChanged applies it
      });
    }
  });
  // Keep every tab in step: settings changed in the popup, or a quality picked in another tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!alive() || area !== "local") return;
    if (changes.config?.newValue) config = { ...config, ...changes.config.newValue };
    if (changes.lastChoice) lastChoice = changes.lastChoice.newValue || null;
    if (changes.config || changes.lastChoice) render();
  });
  chrome.runtime.sendMessage({ to: "bg", type: "jobs" }, (r) => {
    if (!chrome.runtime.lastError && r?.jobs) setJobs(r.jobs);
  });

  on(document, "yt-navigate-finish", () => setTimeout(tick, 50));
  on(window, "popstate", () => setTimeout(tick, 50));
  on(document, "visibilitychange", () => { if (!document.hidden) tick(); });
  // Background tabs do no work; YouTube's own navigation events cover the rest.
  timer = setInterval(() => (orphaned() ? teardown() : document.hidden ? null : tick()), TICK_MS);
  tick();
})();
