// PR "Files changed" helpers:
// - "Collapse all" / "Expand all" buttons in the diff toolbar
// - `v`: mark the file you're reading as viewed and jump to the next unviewed one
// - lockfiles and generated files start collapsed (separate toggle)
//
// Written against the classic (server-rendered) Files changed page. GitHub's
// newer React review page is matched by aria-labels as a best effort.

(() => {
  const FILE = ".file.js-file";
  const isFilesPage = () => /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)/.test(location.pathname);

  function files() {
    return [...document.querySelectorAll(FILE)];
  }

  function toggleButton(file) {
    return file.querySelector(".file-header .js-details-target[aria-expanded]");
  }

  function isExpanded(file) {
    return toggleButton(file)?.getAttribute("aria-expanded") === "true";
  }

  function setExpanded(file, expanded) {
    const btn = toggleButton(file);
    if (btn && isExpanded(file) !== expanded) btn.click();
  }

  function filePath(file) {
    return file.querySelector(".file-header[data-path]")?.dataset.path ?? file.dataset.tagsearchPath ?? "";
  }

  // React review page fallback.
  function reactToggles(expanded) {
    const label = expanded ? "expand" : "collapse";
    return document.querySelectorAll(`button[aria-label^="${label} file" i], button[aria-label^="${label} diff" i]`);
  }

  function setAll(expanded) {
    const classic = files();
    if (classic.length) classic.forEach((f) => setExpanded(f, expanded));
    else reactToggles(expanded).forEach((b) => b.click());
  }

  // ---------- toolbar buttons ----------

  ghqol.register("diffTools", () => {
    ghqol.onScan(() => {
      if (!isFilesPage() || document.querySelector(".ghqol-difftools")) return;
      const tools = document.querySelector(".pr-review-tools");
      if (!tools) return;
      const wrap = document.createElement("div");
      wrap.className = "ghqol-difftools diffbar-item d-flex flex-items-center";
      wrap.style.gap = "4px";
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
      tools.prepend(wrap);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "v" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (!isFilesPage() || ghqol.isTyping(e)) return;
      if (markViewedAndNext()) e.preventDefault();
    });
  });

  // The file being read is the first one whose body is still visible below
  // the sticky headers.
  function currentFile(list) {
    const stickyBottom = Math.max(
      0,
      ...[...document.querySelectorAll(".js-sticky.is-stuck, .diffbar, .gh-header-sticky.is-stuck")].map(
        (el) => el.getBoundingClientRect().bottom,
      ),
    );
    return list.find((f) => f.getBoundingClientRect().bottom > stickyBottom + 40) ?? null;
  }

  function viewedCheckbox(file) {
    return file.querySelector("input.js-reviewed-checkbox");
  }

  function markViewedAndNext() {
    const list = files();
    const cur = currentFile(list);
    if (!cur) return false;
    const box = viewedCheckbox(cur);
    if (box && !box.checked) box.click(); // GitHub collapses viewed files itself
    else setExpanded(cur, false);
    const after = list.slice(list.indexOf(cur) + 1);
    const next = after.find((f) => !viewedCheckbox(f)?.checked) ?? after[0];
    if (next) {
      setExpanded(next, true);
      // Wait a frame so the collapse above has reflowed before measuring.
      requestAnimationFrame(() => {
        const sticky = document.querySelector(".diffbar")?.getBoundingClientRect().bottom ?? 60;
        window.scrollBy({ top: next.getBoundingClientRect().top - sticky - 8 });
      });
    } else {
      ghqol.toast("That was the last file");
    }
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
      for (const file of document.querySelectorAll(`${FILE}:not([data-ghqol-noise])`)) {
        const path = filePath(file);
        const noisy = NOISY.some((re) => re.test(path));
        file.dataset.ghqolNoise = noisy ? "1" : "0";
        if (!noisy || !isExpanded(file)) continue;
        setExpanded(file, false);
        const name = file.querySelector(".file-info .Truncate");
        if (name) {
          const tag = document.createElement("span");
          tag.className = "Label Label--secondary ml-2";
          tag.textContent = "auto-collapsed";
          tag.title = "Collapsed by GitHub QoL (lockfile / generated). Click the chevron to expand.";
          name.after(tag);
        }
      }
    });
  });
})();
