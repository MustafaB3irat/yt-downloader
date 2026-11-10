// Styles for the page UI. Every widget lives in its own shadow root, so nothing here can leak
// into YouTube and YouTube's CSS can't break it. Colours are tokens; change them here only.

YTD.CSS = `
  :host {
    all: initial; font-family: Roboto, Arial, sans-serif;
    --brand: rgba(37,99,235,.92); --brand-hover: rgba(29,78,216,.92); --brand-solid: #2563eb; --link: #3b82f6;
    --ok: #16a34a; --err: #dc2626;
    --fg: #0f0f0f; --muted: #606060; --menu: #fff; --hover: #f2f2f2; --line: #e5e5e5; --shadow: 0 4px 32px rgba(0,0,0,.18);
  }
  :host([data-theme=dark]) { --fg: #f1f1f1; --muted: #aaa; --menu: #282828; --hover: #3e3e3e; --line: #3f3f3f; --shadow: 0 4px 32px rgba(0,0,0,.6); }
  * { box-sizing: border-box; }
  button { font: inherit; cursor: pointer; border: 0; outline: none; }

  /* ---------- download row ---------- */
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 0; font-size: 14px; }
  .group { position: relative; display: flex; border-radius: 8px; }
  .dl, .more { height: 36px; display: flex; align-items: center; justify-content: center; color: #fff; background: var(--brand); }
  .dl { gap: 8px; min-width: 84px; padding: 0 16px 0 12px; border-radius: 8px 0 0 8px; font-size: 14px; font-weight: 500; position: relative; overflow: hidden; }
  .more { width: 36px; border-radius: 0 8px 8px 0; }
  .dl:hover, .more:hover, .dl:focus-visible, .more:focus-visible, .more[aria-expanded=true] { background: var(--brand-hover); }
  .dl .fill { position: absolute; inset: 0 auto 0 0; width: 0; background: rgba(255,255,255,.18); transition: width .3s; pointer-events: none; }
  .dl span { position: relative; display: flex; }
  .dl .chip { font-size: 12px; font-weight: 600; line-height: 20px; padding: 0 6px; margin-left: 2px; border-radius: 4px; background: rgba(255,255,255,.2); }
  .dl .chip:empty { display: none; }
  .sep { width: 1px; background: rgba(96,165,250,.2); }
  .icon { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; color: var(--muted); background: transparent; border-radius: 50%; }
  .icon:hover { background: var(--hover); color: var(--fg); }

  /* ---------- status pill ---------- */
  .status { display: flex; align-items: center; min-width: 0; }
  .row:has(.pill) > .icon { display: none; }
  .pill { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 4px 0 10px; border-radius: 18px; background: var(--hover); color: var(--fg); font-size: 13px; min-width: 0; animation: drop .16s ease-out; }
  .pill .st { width: 20px; height: 20px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center; color: #fff; background: var(--ok); }
  .pill.err .st { background: var(--err); }
  .pill .bar { width: 96px; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; flex: none; }
  .pill .bar i { display: block; height: 100%; width: 0; background: var(--brand-solid); transition: width .3s; }
  .pill .txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; font-variant-numeric: tabular-nums; }
  .pill .txt b { font-weight: 500; }
  .pill .txt span { color: var(--muted); }
  .pill.err .txt { max-width: 300px; }
  .pill .acts { display: flex; align-items: center; gap: 2px; flex: none; }
  .pill .tb { height: 28px; padding: 0 12px; border-radius: 14px; background: var(--brand-solid); color: #fff; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .pill .tb:hover, .pill .tb:focus-visible { background: var(--brand-hover); }
  .pill .ib { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: transparent; color: var(--muted); }
  .pill .ib:hover, .pill .ib:focus-visible { background: var(--line); color: var(--fg); }

  /* ---------- quality menu ---------- */
  .menu { position: absolute; top: calc(100% + 8px); left: 0; z-index: 2300; width: 380px; max-width: calc(100vw - 32px); max-height: min(72vh, 620px);
    overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--line) transparent;
    background: var(--menu); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow);
    padding: 0 0 8px; display: none; font-size: 14px; }
  .menu.open { display: block; animation: drop .14s ease-out; }
  .menu.up { top: auto; bottom: calc(100% + 8px); }
  .menu.up.open { animation: rise .14s ease-out; }
  @keyframes drop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  @keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .menu .top { position: sticky; top: 0; z-index: 1; display: flex; gap: 12px; align-items: center; padding: 12px 16px; background: var(--menu); border-bottom: 1px solid var(--line); margin-bottom: 6px; }
  .menu .top img { width: 64px; height: 36px; object-fit: cover; border-radius: 6px; flex: none; background: var(--hover); }
  .menu .top .tt { min-width: 0; }
  .menu .top b, .menu .top small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .menu .top b { font-size: 14px; font-weight: 500; line-height: 1.3; }
  .menu .top small { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .menu .h { padding: 10px 16px 6px; font-size: 12px; font-weight: 500; color: var(--muted); }
  .menu .it { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 40px; padding: 0 16px; background: transparent; color: var(--fg); text-align: left; font-size: 14px; }
  .menu .it svg { flex: none; color: var(--muted); }
  .menu .it:hover, .menu .it:focus-visible { background: var(--hover); }
  .menu .it:hover svg { color: var(--fg); }
  .menu .it.sel { background: rgba(37,99,235,.16); }
  .menu .it.sel .q::after { content: "  ✓"; color: var(--link); }
  .menu .it .q { font-variant-numeric: tabular-nums; min-width: 46px; }
  .menu .it.best .q { min-width: 0; }
  .menu .it .bs { display: flex; gap: 4px; }
  .menu .it .sz { margin-left: auto; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .menu .div { height: 1px; background: var(--line); margin: 6px 0; }
  .menu .sk { display: flex; align-items: center; gap: 12px; height: 40px; padding: 0 16px; }
  .menu .sk i { display: block; height: 12px; border-radius: 6px; background: var(--hover); animation: pulse 1.2s ease-in-out infinite; }
  .menu .sk i:first-child { width: 20px; height: 20px; border-radius: 5px; }
  @keyframes pulse { 50% { opacity: .45; } }
  .menu .foot { display: flex; gap: 4px; padding: 6px 8px 0; border-top: 1px solid var(--line); margin-top: 6px; }
  .menu .foot button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 36px; border-radius: 8px; background: transparent; color: var(--muted); font-size: 13px; }
  .menu .foot button:hover { background: var(--hover); color: var(--fg); }
  .badge { font-size: 11px; font-weight: 600; line-height: 16px; padding: 0 5px; border-radius: 4px; color: #fff; background: #6b7280; }
  .b8k { background: #9333ea; } .b4k { background: #dc2626; } .b2k { background: #ea580c; } .bhd { background: #2563eb; } .bhdr { background: #ca8a04; } .bfps { background: #0d9488; }

  /* ---------- Shorts ---------- */
  .short { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 16px; }
  .short button { width: 48px; height: 48px; border-radius: 50%; color: #fff; background: var(--brand); display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
  .short button:hover { background: var(--brand-hover); }
  .short .lbl { color: var(--fg); font-size: 12px; text-align: center; }
  .short .ring { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(rgba(255,255,255,.45) var(--p, 0%), transparent 0); }

  /* ---------- floating fallback & toast ---------- */
  .float { position: fixed; z-index: 2300; }
  .float.watch { left: 16px; bottom: 16px; }
  .float.shorts { right: 16px; bottom: 96px; }
  .float .row { background: var(--menu); padding: 8px 10px; border-radius: 10px; box-shadow: var(--shadow); }
  .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2400; max-width: 560px; padding: 12px 16px; border-radius: 8px;
    background: #0f0f0f; color: #fff; font-size: 13px; line-height: 1.4; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
  .toast code { background: #333; padding: 1px 5px; border-radius: 4px; }
`;
