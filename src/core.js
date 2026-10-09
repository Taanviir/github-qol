// Shared plumbing for every feature script. Loaded first; all content scripts
// share one isolated world, so features reach it via `window.ghqol`.
//
// A feature calls `ghqol.register(key, init)`. Once settings load, `init` runs
// if the feature is enabled. GitHub mixes Turbo page loads and React
// client-side routing, so instead of hooking either, features that decorate
// the DOM use `ghqol.onScan`, which re-runs (debounced) whenever the page
// changes. Scanners must be idempotent.

(() => {
  if (window.ghqol) return;

  const DEFAULTS = {
    imageLightbox: true,
    diffTools: true,
    hideNoisyDiffs: true,
    absoluteDates: true,
    expandTimeline: true,
    linkifyPaths: true,
    shortcuts: true,
    stickyBlame: true,
    annotatePaste: true,
  };

  const features = [];
  const scanners = [];
  const urlListeners = [];

  const ghqol = {
    DEFAULTS,
    settings: null,

    register(key, init) {
      features.push({ key, init });
    },

    onScan(fn) {
      scanners.push(fn);
      if (started) safe(fn);
    },

    onUrlChange(fn) {
      urlListeners.push(fn);
    },

    isTyping(e) {
      const t = e.composedPath?.()[0] ?? e.target;
      return (
        t instanceof Element &&
        (t.matches("input, textarea, select, [contenteditable=''], [contenteditable='true']") ||
          t.isContentEditable)
      );
    },

    // { owner, repo } when the current page belongs to a repository.
    repo() {
      const nwo = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')?.content;
      const fromPath = location.pathname.split("/").filter(Boolean);
      const [owner, repo] = nwo ? nwo.split("/") : fromPath;
      if (!owner || !repo) return null;
      // The meta tag can be stale after client-side navigation; trust the URL.
      if (fromPath[0] !== owner || fromPath[1] !== repo) return null;
      return { owner, repo };
    },

    toast(message, ms = 2500) {
      const el = document.createElement("div");
      el.textContent = message;
      Object.assign(el.style, {
        position: "fixed",
        left: "50%",
        bottom: "24px",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        padding: "8px 14px",
        borderRadius: "6px",
        background: "#1f2328",
        color: "#fff",
        font: "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        boxShadow: "0 4px 16px rgba(0,0,0,.3)",
        pointerEvents: "none",
      });
      document.body.appendChild(el);
      setTimeout(() => el.remove(), ms);
    },
  };

  function safe(fn, ...args) {
    try {
      return fn(...args);
    } catch (err) {
      console.error("[GitHub QoL]", err);
    }
  }

  let started = false;
  let scanQueued = false;
  let lastUrl = location.href;

  function runScanners() {
    scanQueued = false;
    if (location.href !== lastUrl) {
      const prev = lastUrl;
      lastUrl = location.href;
      for (const fn of urlListeners) safe(fn, location.href, prev);
    }
    for (const fn of scanners) safe(fn);
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(runScanners, 150);
  }

  window.ghqol = ghqol;

  // Content scripts listed after this one run synchronously before this
  // promise resolves, so every feature has registered by then.
  chrome.storage.sync.get(DEFAULTS).then((settings) => {
    ghqol.settings = settings;
    for (const { key, init } of features) {
      if (settings[key]) safe(init);
    }
    started = true;
    runScanners();
    new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true });
    // pushState doesn't always touch the DOM right away; catch those too.
    window.addEventListener("popstate", queueScan);
    document.addEventListener("turbo:load", queueScan);
  });
})();
