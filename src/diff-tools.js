// PR "Files changed" helpers:
// - "Collapse all" / "Expand all" buttons in the diff toolbar
// - `v`: mark the file you're reading as viewed and jump to the next unviewed one
// - lockfiles and generated files start collapsed (separate toggle)
//
// GitHub serves two versions of this page: the classic server-rendered one
// (/pull/N/files, what logged-out visitors get) and the React review page
// (/pull/N/changes, most signed-in accounts). Each gets an adapter below.

(() => {
  const isFilesPage = () => /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)/.test(location.pathname);

  const classic = {
    files: () => [...document.querySelectorAll(".file.js-file")],
    path: (f) => f.querySelector(".file-header[data-path]")?.dataset.path ?? f.dataset.tagsearchPath ?? "",
    toggle: (f) => f.querySelector(".file-header .js-details-target[aria-expanded]"),
    isExpanded: (f) => classic.toggle(f)?.getAttribute("aria-expanded") === "true",
    viewedButton: (f) => f.querySelector("input.js-reviewed-checkbox"),
    isViewed: (f) => !!classic.viewedButton(f)?.checked,
    nameEl: (f) => f.querySelector(".file-info .Truncate"),
    toolbarSlot: () => document.querySelector(".pr-review-tools"),
    stickyBottom: () => document.querySelector(".diffbar")?.getBoundingClientRect().bottom ?? 60,
  };

  // React page: icon buttons carry no aria-label; their name comes from a
  // tooltip element referenced by aria-labelledby ("Collapse file").
  const labelOf = (btn) =>
    btn.getAttribute("aria-label") || document.getElementById(btn.getAttribute("aria-labelledby"))?.textContent || "";

  // GitHub's CSS-module class names have changed shape over time
  // ("DiffFileHeader-module__diff-file-header__x1" → "diff-file-header__x1"),
  // so match only the stable fragment.
  const TOOLBAR = "section[class*='toolbar__']";

  const react = {
    // Each file's body holds more diff-* regions of its own; skip those.
    files: () => [...document.querySelectorAll("div[role='region'][id^='diff-']:not(div[role='region'][id^='diff-'] *)")],
    header: (f) => f.querySelector("[class*='diff-file-header']"),
    // The name is wrapped in U+200E direction marks, which would defeat `$` in NOISY.
    path: (f) => react.header(f)?.querySelector("h3 code, h3")?.textContent.replace(/[\u200e\u200f]/g, "").trim() ?? "",
    toggle: (f) =>
      [...(react.header(f)?.querySelectorAll("button") ?? [])].find((b) => /^(collapse|expand) file$/i.test(labelOf(b).trim())),
    isExpanded: (f) => /^collapse/i.test(labelOf(react.toggle(f) ?? document.createElement("i")).trim()),
    viewedButton: (f) => react.header(f)?.querySelector("button[aria-pressed][class*='MarkAsViewedButton' i], button[aria-pressed][aria-label$='Viewed']"),
    isViewed: (f) => react.viewedButton(f)?.getAttribute("aria-pressed") === "true",
    nameEl: (f) => react.header(f)?.querySelector("h3"),
    // Right-hand group of the sticky toolbar (viewed count, Submit review).
    toolbarSlot: () => document.querySelector(TOOLBAR)?.lastElementChild,
    stickyBottom: () =>
      document.querySelector(TOOLBAR)?.getBoundingClientRect().bottom ?? 60,
  };

  const page = () => (document.querySelector(".file.js-file, .pr-review-tools") ? classic : react);

  // A toggle's state (its tooltip text on the React page) can lag a click,
  // so reading it right after would see the old state and a second click
  // would undo the first. For a moment after clicking, trust the state we
  // asked for instead.
  const pending = new WeakMap(); // file element -> { expanded, at }

  function expandedState(p, file) {
    const recent = pending.get(file);
    return recent && Date.now() - recent.at < 1000 ? recent.expanded : p.isExpanded(file);
  }

  function setExpanded(p, file, expanded) {
    const btn = p.toggle(file);
    if (!btn || expandedState(p, file) === expanded) return false;
    pending.set(file, { expanded, at: Date.now() });
    btn.click();
    return true;
  }

  // On the classic page "Collapse all" clicks each file's toggle, in passes
  // until nothing is left to do. On either page it then keeps collapsing
  // files that mount later (the React page can render headers lazily) until
  // "Expand all" or navigation. Tracking by path means a file you expand by
  // hand stays expanded even if GitHub re-mounts it.
  let collapseMode = null; // Set of paths already handled, while active

  async function setAll(expanded) {
    const p = page();
    collapseMode = expanded ? null : new Set();
    // The React page has its own "all files" toggle: Alt+click on any file's
    // chevron sets every file to the opposite of that file's state in one
    // render. Clicking each toggle instead swamps it on a big PR, and on a
    // slow machine some of those clicks never land.
    if (p === react) {
      const files = p.files();
      if (collapseMode) for (const f of files) collapseMode.add(p.path(f));
      const btn = files.map((f) => expandedState(p, f) !== expanded && p.toggle(f)).find(Boolean);
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, altKey: true }));
      return;
    }
    for (let pass = 0; pass < 20; pass++) {
      let changed = 0;
      for (const f of p.files()) {
        if (collapseMode) collapseMode.add(p.path(f));
        if (setExpanded(p, f, expanded)) changed++;
      }
      if (!changed) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  function collapseNewlyMounted() {
    if (!collapseMode) return;
    const p = page();
    for (const f of p.files()) {
      const path = p.path(f);
      if (!path || !p.toggle(f) || collapseMode.has(path)) continue;
      collapseMode.add(path);
      setExpanded(p, f, false);
    }
  }

  ghqol.onUrlChange(() => {
    collapseMode = null;
  });

  // ---------- toolbar buttons + `v` ----------

  ghqol.register("diffTools", () => {
    ghqol.onScan(collapseNewlyMounted);

    ghqol.onScan(() => {
      if (!isFilesPage() || document.querySelector(".ghqol-difftools")) return;
      const p = page();
      const slot = p.toolbarSlot();
      if (!slot || !p.files().length) return;
      const wrap = document.createElement("div");
      wrap.className = "ghqol-difftools d-flex flex-items-center";
      wrap.style.gap = "4px";
      if (p === classic) wrap.classList.add("diffbar-item");
      else wrap.style.marginRight = "8px";
      for (const [label, expanded] of [
        ["Collapse all", false],
        ["Expand all", true],
      ]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-sm";
        b.textContent = label;
        b.addEventListener("click", () => setAll(expanded));
        wrap.appendChild(b);
      }
      slot.prepend(wrap);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "v" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (!isFilesPage() || ghqol.isTyping(e)) return;
      if (markViewedAndNext()) e.preventDefault();
    });
  });

  // The file being read is the first one whose body is still visible below
  // the sticky toolbar.
  function currentFile(p, list) {
    const top = p.stickyBottom();
    return list.find((f) => f.getBoundingClientRect().bottom > top + 40) ?? null;
  }

  function markViewedAndNext() {
    const p = page();
    const list = p.files();
    const cur = currentFile(p, list);
    if (!cur) return false;
    const viewed = p.viewedButton(cur);
    if (viewed && !p.isViewed(cur)) viewed.click(); // GitHub collapses viewed files itself
    else setExpanded(p, cur, false);
    const after = list.slice(list.indexOf(cur) + 1);
    const next = after.find((f) => !p.isViewed(f)) ?? after[0];
    if (!next) {
      ghqol.toast("That was the last file");
      return true;
    }
    setExpanded(p, next, true);
    // Let the collapse above reflow before measuring.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.scrollBy({ top: next.getBoundingClientRect().top - p.stickyBottom() - 8 });
      }),
    );
    return true;
  }

  // ---------- auto-collapse noisy files ----------

  const NOISY = [
    /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|deno\.lock)$/,
    /(^|\/)(Cargo\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|pdm\.lock|composer\.lock|Gemfile\.lock|go\.sum|flake\.lock|mix\.lock|pubspec\.lock|Podfile\.lock|packages\.lock\.json|gradle\.lockfile)$/,
    /\.min\.(js|css)$/,
    /\.(js|css)\.map$/,
    /(^|\/)__snapshots__\//,
    /\.snap$/,
    /(^|\/)(dist|vendor)\//,
    /\.(generated|gen|pb)\.\w+$/,
    /_pb2(_grpc)?\.py$/,
  ];

  ghqol.register("hideNoisyDiffs", () => {
    ghqol.onScan(() => {
      if (!isFilesPage()) return;
      const p = page();
      for (const file of p.files()) {
        if (file.dataset.ghqolNoise) continue;
        const path = p.path(file);
        if (!path || !p.toggle(file)) continue; // header not rendered yet
        const noisy = NOISY.some((re) => re.test(path));
        file.dataset.ghqolNoise = noisy ? "1" : "0";
        if (!noisy || !expandedState(p, file)) continue;
        setExpanded(p, file, false);
        const name = p.nameEl(file);
        if (name && !name.parentElement.querySelector(".ghqol-noise-tag")) {
          const tag = document.createElement("span");
          tag.className = "ghqol-noise-tag Label Label--secondary ml-2";
          tag.textContent = "auto-collapsed";
          tag.title = "Collapsed by GitHub QoL (lockfile / generated). Click the chevron to expand.";
          name.after(tag);
        }
      }
    });
  });
})();
