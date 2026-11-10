// Showing a job's state: progress on the Download button, the status pill beside it, and the
// ring on the Shorts button. Pill buttons carry data-do / data-job; main.js handles the clicks.

YTD.status = (() => {
  const { icon, escapeHtml, fmtSize, isActive, progress } = YTD;

  // Main button: live progress while downloading, otherwise "Download" plus the remembered choice.
  function renderButton(root, job, choiceLabel) {
    const active = isActive(job);
    const pct = active ? progress(job).pct : 0;
    root.querySelector(".dl .fill").style.width = `${pct}%`;
    root.querySelector(".dl .lbl").textContent = !active ? "Download" : job.status === "processing" ? "Processing" : `${pct}%`;
    root.querySelector(".dl .chip").textContent = active ? "" : choiceLabel;
  }

  // Re-render only when the job or its state changes; progress ticks update the existing pill
  // in place so it doesn't flicker or steal focus.
  function renderPill(slot, job) {
    const key = job ? `${job.id}:${job.status}` : "";
    if (job && isActive(job) && slot.dataset.key === key) {
      const p = progress(job);
      slot.querySelector(".bar i").style.width = `${p.pct}%`;
      slot.querySelector(".txt").textContent = p.text;
      return;
    }
    if (slot.dataset.key === key) return;
    slot.dataset.key = key;
    slot.innerHTML = job ? pillHTML(job) : "";
  }

  function pillHTML(job) {
    const button = (action, label, iconName, primary = false) => {
      const size = primary ? 14 : iconName === "close" ? 16 : 17;
      return `<button class="${primary ? "tb" : "ib"}" data-job="${escapeHtml(job.id)}" data-do="${action}" title="${label}" aria-label="${label}">`
        + `${icon(iconName, size)}${primary ? label : ""}</button>`;
    };
    const pill = ({ cls = "", lead, text, title = "", actions }) =>
      `<div class="pill ${cls}" title="${escapeHtml(title)}">${lead}<span class="txt">${text}</span><span class="acts">${actions.join("")}</span></div>`;
    const dot = (name) => `<span class="st">${icon(name, 13)}</span>`;

    if (isActive(job)) {
      const p = progress(job);
      return pill({
        lead: `<span class="bar"><i style="width:${p.pct}%"></i></span>`,
        text: escapeHtml(p.text),
        actions: [button("cancel", "Cancel download", "close")],
      });
    }
    if (job.status === "done") {
      const ext = (job.filepath || "").split(".").pop();
      const meta = [/^[a-z0-9]{2,4}$/i.test(ext) ? ext.toUpperCase() : "", fmtSize(job.total)].filter(Boolean).join(" · ");
      return pill({
        lead: dot("check"),
        text: `<b>Saved</b>${meta ? ` <span>· ${escapeHtml(meta)}</span>` : ""}`,
        title: job.filepath || "",
        actions: [button("open", "Open", "play", true), button("reveal", "Show in Finder", "folder"), button("dismiss", "Dismiss", "close")],
      });
    }
    const error = job.error || "unknown error";
    return pill({
      cls: "err",
      lead: dot("alert"),
      text: `<b>Couldn't download</b> <span>· ${escapeHtml(error)}</span>`,
      title: error,
      actions: [button("retry", "Retry", "retry", true), button("dismiss", "Dismiss", "close")],
    });
  }

  function renderShort(root, job) {
    const active = isActive(job);
    const pct = active ? progress(job).pct : 0;
    root.querySelector(".ring").style.setProperty("--p", `${pct}%`);
    const label = { done: "Saved", error: "Failed" }[job?.status];
    root.querySelector(".lbl").textContent = active ? `${pct}%` : label || "Download";
  }

  return { renderButton, renderPill, renderShort };
})();
