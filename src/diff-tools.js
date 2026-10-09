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

  const react = {
    files: () => [...document.querySelectorAll("div[role='region'][id^='diff-']")],
    header: (f) => f.querySelector("[class*='DiffFileHeader-module__diff-file-header']"),
    path: (f) => react.header(f)?.querySelector("h3 code, h3")?.textContent.trim() ?? "",
    toggle: (f) =>
      [...(react.header(f)?.querySelectorAll("button") ?? [])].find((b) => /^(collapse|expand) file$/i.test(labelOf(b).trim())),
    isExpanded: (f) => /^collapse/i.test(labelOf(react.toggle(f) ?? document.createElement("i")).trim()),
    viewedButton: (f) => react.header(f)?.querySelector("button[aria-pressed][class*='MarkAsViewedButton'], button[aria-pressed][aria-label$='Viewed']"),
    isViewed: (f) => react.viewedButton(f)?.getAttribute("aria-pressed") === "true",
    nameEl: (f) => react.header(f)?.querySelector("h3"),
    // Right-hand group of the sticky toolbar (viewed count, Submit review).
    toolbarSlot: () => document.querySelector("section[class*='PullRequestFilesToolbar-module__toolbar']")?.lastElementChild,
    stickyBottom: () =>
      document.querySelector("section[class*='PullRequestFilesToolbar-module__toolbar']")?.getBoundingClientRect().bottom ?? 60,
  };

  const page = () => (document.querySelector(".file.js-file, .pr-review-tools") ? classic : react);

  function setExpanded(p, file, expanded) {
    const btn = p.toggle(file);
    if (btn && p.isExpanded(file) !== expanded) btn.click();
  }

  function setAll(expanded) {
    const p = page();
    p.files().forEach((f) => setExpanded(p, f, expanded));
  }

  // ---------- toolbar buttons + `v` ----------

  ghqol.register("diffTools", () => {
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
        if (!noisy || !p.isExpanded(file)) continue;
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
