// Adds a "Load all" button next to GitHub's "N hidden items / Load more…"
// timeline buttons on long PRs and issues, which keeps clicking "Load more"
// until everything is shown.

ghqol.register("expandTimeline", () => {
  // Classic PR timeline, and the React issue timeline.
  const LOAD_MORE = ".ajax-pagination-form .ajax-pagination-btn, button[data-testid^='issue-timeline-load-more-load']";

  let running = false;

  function loadMoreButtons() {
    return [...document.querySelectorAll(LOAD_MORE)].filter(
      (b) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && !b.closest(".ghqol-load-all"),
    );
  }

  function waitFor(cond, timeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const id = setInterval(() => {
        if (cond() || Date.now() - start > timeout) {
          clearInterval(id);
          resolve(cond());
        }
      }, 150);
    });
  }

  async function loadAll(button) {
    if (running) return;
    running = true;
    button.disabled = true;
    let rounds = 0;
    let stuck = false;
    try {
      for (; rounds < 200; rounds++) {
        // A batch is done once a "Load more" is clickable again, or none are
        // left. (React re-renders the button while loading, so we can't just
        // watch the one we clicked.)
        const settled = await waitFor(
          () => loadMoreButtons().length > 0 || !document.querySelector(LOAD_MORE),
          30000,
        );
        const next = loadMoreButtons()[0];
        if (!next) {
          stuck = !settled; // rate limited or failed; stop rather than spin
          break;
        }
        button.textContent = `Loading… (${rounds + 1})`;
        next.click();
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      running = false;
      if (button.isConnected) button.remove();
      if (stuck) ghqol.toast("GitHub stopped responding, so not everything was loaded");
      else if (rounds) ghqol.toast("Loaded the full timeline");
    }
  }

  ghqol.onScan(() => {
    if (running) return;
    const pending = loadMoreButtons();
    if (!pending.length) document.querySelectorAll(".ghqol-load-all").forEach((b) => b.remove());
    for (const btn of pending) {
      const anchor = btn.closest(".ajax-pagination-form") ?? btn;
      if (anchor.nextElementSibling?.classList.contains("ghqol-load-all")) continue;
      // One "Load all" per page is enough.
      if (document.querySelector(".ghqol-load-all")) return;
      const all = document.createElement("button");
      all.type = "button";
      all.className = "ghqol-load-all btn btn-sm mt-2 mb-2";
      all.style.display = "block";
      all.style.margin = "8px auto";
      all.textContent = "Load all hidden items";
      all.addEventListener("click", () => loadAll(all));
      anchor.after(all);
      return;
    }
  });
});
