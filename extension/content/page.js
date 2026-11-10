// Reading the YouTube page: which video is open and where our widgets can be placed.
// The video is always identified from the URL, never from YouTube's internals. Anchors are
// tried in order, so when YouTube moves things around the next one (or the floating fallback)
// takes over instead of the button disappearing.

YTD.page = (() => {
  const { parseVideo, videoUrl } = YTD;

  const TOP_BAR_HEIGHT = 56; // YouTube's fixed masthead

  // Watch page: [container, insert-before] pairs, best first.
  const WATCH_ANCHORS = [
    () => { const el = document.querySelector("ytd-watch-flexy #below"); return el && [el, el.firstElementChild]; },
    () => { const el = document.querySelector("ytd-watch-metadata"); return el?.parentElement && [el.parentElement, el]; },
    () => { const el = document.querySelector("#above-the-fold"); return el?.parentElement && [el.parentElement, el]; },
  ];

  // Shorts: the action bar beside the active Short; the button is prepended.
  const SHORTS_ANCHORS = [
    "ytd-reel-video-renderer[is-active] #actions",
    "ytd-reel-video-renderer[is-active] reel-action-bar-view-model",
    "reel-action-bar-view-model",
    "#actions.ytd-reel-player-overlay-renderer",
  ];

  const current = () => parseVideo(location.href);

  return {
    TOP_BAR_HEIGHT,
    kind: () => current().kind,
    videoId: () => current().id,
    videoUrl: () => videoUrl(current()),
    playlistId: () => new URLSearchParams(location.search).get("list"),
    hasWatchLayout: () => !!document.querySelector("ytd-watch-flexy"),

    title() {
      const el = document.querySelector("ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1");
      return (el?.textContent || document.title.replace(/ - YouTube$/, "")).trim();
    },

    theme: () => (document.documentElement.hasAttribute("dark") ? "dark" : "light"),

    visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    },

    watchAnchor() {
      for (const find of WATCH_ANCHORS) {
        const found = find();
        if (found) return { parent: found[0], before: found[1] };
      }
      return null;
    },

    shortsAnchor() {
      for (const sel of SHORTS_ANCHORS) {
        const el = [...document.querySelectorAll(sel)].find(this.visible);
        if (el) return el;
      }
      return null;
    },
  };
})();
