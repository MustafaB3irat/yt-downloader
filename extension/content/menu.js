// The quality menu behind the ⋮ button: markup, quality rows and on-screen placement.
// Items carry their download options in data-* attributes; main.js turns a click into a download.

YTD.menu = (() => {
  const { icon, escapeHtml, fmtSize, resolutionLabel, page } = YTD;

  const MAX_HEIGHT = 620;
  const MIN_HEIGHT = 200;
  const PREFERRED_ROOM_ABOVE = 380; // open upward whenever at least this much space is free
  const EDGE_GAP = 16;
  const FALLBACK_HEIGHTS = [2160, 1440, 1080, 720, 480, 360]; // offered when the helper can't list formats

  function badges(q) {
    const out = [];
    const label = resolutionLabel(q.height);
    if (label.endsWith("K")) out.push(`<span class="badge b${label.toLowerCase()}">${label}</span>`);
    else if (q.height >= 720) out.push('<span class="badge bhd">HD</span>');
    if (q.fps > 30) out.push(`<span class="badge bfps">${Math.round(q.fps)}fps</span>`);
    if (q.hdr) out.push('<span class="badge bhdr">HDR</span>');
    return out.join("");
  }

  const item = ({ data, iconName, label, extra = "", selected = false, cls = "" }) => {
    const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`).join("");
    return `<button class="it${cls ? ` ${cls}` : ""}${selected ? " sel" : ""}"${attrs}>${icon(iconName)}${label}${extra}</button>`;
  };
  const section = (title) => `<div class="div"></div><div class="h">${title}</div>`;

  // Static part of the menu; quality rows arrive later via qualityRows().
  function shell({ videoId, title, saveDir, audioQuality, audioFormat, playlist, isSelected }) {
    const thumb = videoId ? `<img src="https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg" alt="">` : "";
    const skeleton = [70, 58, 64, 52].map((w) => `<div class="sk"><i></i><i style="width:${w}%"></i></div>`).join("");
    const playlistItems = playlist ? section("Playlist")
      + item({ data: { mode: "video", playlist: "1" }, iconName: "playlist", label: "<span>Whole playlist · video</span>" })
      + item({ data: { mode: "audio", playlist: "1" }, iconName: "playlist", label: `<span>Whole playlist · ${escapeHtml(audioFormat.toUpperCase())}</span>` })
      : "";
    return `
      <div class="top">${thumb}<div class="tt"><b>${escapeHtml(title)}</b><small>Saves to ${escapeHtml(saveDir)}</small></div></div>
      <div class="h">Video · MP4</div><div class="qs">${skeleton}</div>
      ${section("Audio")}
      ${item({ data: { mode: "audio", fmt: "mp3" }, iconName: "music", label: `<span>MP3 · ${escapeHtml(audioQuality)} kbps</span>`, extra: '<span class="sz" data-audio-size></span>', selected: isSelected("audio", null, "mp3") })}
      ${item({ data: { mode: "audio", fmt: "m4a" }, iconName: "music", label: "<span>M4A · AAC original</span>", selected: isSelected("audio", null, "m4a") })}
      ${item({ data: { mode: "audio", fmt: "opus" }, iconName: "music", label: "<span>Opus · best original</span>", selected: isSelected("audio", null, "opus") })}
      ${section("More")}
      ${item({ data: { mode: "video", subs: "srt" }, iconName: "subtitles", label: "<span>Video + subtitles (.srt)</span>" })}
      ${item({ data: { mode: "thumbnail" }, iconName: "image", label: "<span>Thumbnail (JPG)</span>" })}
      ${playlistItems}
      <div class="foot">
        <button data-foot="folder">${icon("folder", 18)}Open folder</button>
        <button data-foot="settings">${icon("gear", 18)}Settings</button>
      </div>`;
  }

  function qualityRows(qualities, isSelected) {
    const list = qualities?.length ? qualities : FALLBACK_HEIGHTS.map((height) => ({ height, fps: 30 }));
    const top = list[0];
    const best = item({
      data: { mode: "video", height: "" }, iconName: "star", cls: "best", selected: isSelected("video", null),
      label: '<span class="q">Best available</span>',
      extra: `<span class="bs">${badges(top)}</span><span class="sz">${top.height}p</span>`,
    });
    return best + list.map((q) => item({
      data: { mode: "video", height: q.height }, iconName: "video", selected: isSelected("video", q.height),
      label: `<span class="q">${q.height}p</span>`,
      extra: `<span class="bs">${badges(q)}</span><span class="sz">${fmtSize(q.size)}</span>`,
    })).join("");
  }

  // Estimated MP3 size: bitrate × duration.
  const audioSize = (kbps, seconds) => fmtSize((Number(kbps) * 1000 / 8) * seconds);

  // Open upward over the player when there's room (like YouTube's own menus), else downward,
  // and cap the height to the space available.
  function place(menu, anchor) {
    const r = anchor.getBoundingClientRect();
    const above = r.top - page.TOP_BAR_HEIGHT - EDGE_GAP;
    const below = innerHeight - r.bottom - EDGE_GAP;
    const up = above >= PREFERRED_ROOM_ABOVE || above > below;
    menu.classList.toggle("up", up);
    menu.style.maxHeight = `${Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, (up ? above : below) - 8))}px`;
  }

  // Download options encoded on a clicked menu item.
  function choiceFrom(el) {
    const d = el.dataset;
    return {
      mode: d.mode,
      height: d.height ? Number(d.height) : null,
      audioFormat: d.fmt || undefined,
      subtitles: d.subs || undefined,
      playlist: d.playlist === "1",
    };
  }

  return { shell, qualityRows, audioSize, place, choiceFrom };
})();
