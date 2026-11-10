// Helpers shared by every extension context: content scripts, the popup and the service worker.
// Classic script that defines one global namespace, YTD. Each load creates a fresh object, so a
// re-injected content script never shares state with a stale copy still running in the tab.

globalThis.YTD = (() => {
  const ACTIVE_STATUSES = ["queued", "running", "processing"];
  const isActive = (job) => !!job && ACTIVE_STATUSES.includes(job.status);

  const INSTALL_HINT = "In Terminal, run <code>./install.sh</code> from the YT-Downloader folder";

  // Chrome's wording when the native host isn't registered or can't be started.
  const isHostMissing = (message) => /native messaging host|not found|not installed|forbidden/i.test(String(message || ""));

  // ---------- YouTube URLs ----------
  function parseVideo(href) {
    try {
      const url = new URL(href);
      if (url.hostname === "youtu.be") return { kind: "watch", id: url.pathname.slice(1) || null };
      const shorts = url.pathname.match(/^\/shorts\/([\w-]{6,})/);
      if (shorts) return { kind: "shorts", id: shorts[1] };
      if (url.pathname === "/watch") return { kind: "watch", id: url.searchParams.get("v") };
    } catch { /* not a URL */ }
    return { kind: null, id: null };
  }

  function videoUrl({ kind, id }) {
    if (!id) return null;
    return kind === "shorts" ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
  }

  // Strip playlist, timestamp and tracking params so the helper always sees one URL per video.
  const canonicalUrl = (href) => videoUrl(parseVideo(href)) || href;

  // ---------- formatting ----------
  function fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e7) return `${Math.round(bytes / 1e6)} MB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  }

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

  // "8K" / "4K" / "2K" for big resolutions, otherwise "1080p".
  function resolutionLabel(height) {
    if (height >= 4320) return "8K";
    if (height >= 2160) return "4K";
    if (height >= 1440) return "2K";
    return `${height}p`;
  }

  // Progress line for a queued/running/processing job.
  function progress(job) {
    const pct = Math.round(job.progress || 0);
    if (job.status === "queued") return { pct: 0, text: "Waiting…" };
    if (job.status === "processing") return { pct: 100, text: job.mode === "audio" ? "Converting…" : "Merging video & audio…" };
    if (job.stage && !["downloading", "starting"].includes(job.stage)) {
      return { pct, text: job.stage[0].toUpperCase() + job.stage.slice(1) + "…" };
    }
    const parts = [`Downloading ${pct}%`];
    if (job.speed) parts.push(`${(job.speed / 1e6).toFixed(1)} MB/s`);
    if (job.playlistIndex) parts.push(`${job.playlistIndex}/${job.playlistCount || "?"}`);
    return { pct, text: parts.join(" · ") };
  }

  return {
    ACTIVE_STATUSES, isActive, INSTALL_HINT, isHostMissing,
    parseVideo, videoUrl, canonicalUrl,
    fmtSize, escapeHtml, resolutionLabel, progress,
  };
})();
