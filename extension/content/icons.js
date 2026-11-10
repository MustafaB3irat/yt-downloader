// Inline SVG icons for the page UI. icon(name, size) returns markup sized for the spot it goes in.

(() => {
  const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
  const FILL = 'fill="currentColor"';

  // name: [style, stroke width, inner markup]
  const ICONS = {
    download: [STROKE, 2, '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'],
    more: [FILL, 0, '<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/>'],
    check: [STROKE, 3, '<path d="m5 12.5 4.5 4.5L19 7.5"/>'],
    alert: [STROKE, 3, '<path d="M12 6v7"/><path d="M12 18h.01"/>'],
    close: [STROKE, 2, '<path d="M6 6l12 12M18 6 6 18"/>'],
    play: [FILL, 0, '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>'],
    retry: [STROKE, 2.2, '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'],
    folder: [STROKE, 1.8, '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'],
    gear: [STROKE, 1.8, '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'],
    video: [STROKE, 1.8, '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>'],
    star: [STROKE, 1.8, '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'],
    music: [STROKE, 1.8, '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'],
    subtitles: [STROKE, 1.8, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M14 15h3M7 11h2M12 11h5"/>'],
    image: [STROKE, 1.8, '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'],
    playlist: [STROKE, 1.8, '<path d="M4 6h12M4 12h12M4 18h8"/><path d="m16 15 5 3-5 3z" fill="currentColor"/>'],
  };

  YTD.icon = (name, size = 20) => {
    const [style, width, body] = ICONS[name];
    const stroke = width ? ` stroke-width="${width}"` : "";
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${style}${stroke} aria-hidden="true">${body}</svg>`;
  };
})();
