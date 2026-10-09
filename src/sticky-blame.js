// Remembers whether you were reading files in Code or Blame view. Switch to
// Blame once, and clicking through to other files keeps you in Blame until
// you switch back to Code.

ghqol.register("stickyBlame", () => {
  const FILE_RE = /^\/([^/]+)\/([^/]+)\/(blob|blame)\/(.+)$/;
  // Blame makes no sense for these; let them open normally.
  const NO_BLAME = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|pdf|zip|gz|tgz|mp4|mov|webm|woff2?|ttf|otf|ipynb)$/i;

  let mode = "blob";
  chrome.storage.local.get({ fileViewMode: "blob" }).then((s) => {
    mode = s.fileViewMode;
  });

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    chrome.storage.local.set({ fileViewMode: m });
  }

  function parse(href) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return null;
    const m = url.pathname.match(FILE_RE);
    return m ? { url, owner: m[1], repo: m[2], view: m[3], rest: m[4] } : null;
  }

  function blameUrl(p) {
    return `/${p.owner}/${p.repo}/blame/${p.rest}${p.url.search}${p.url.hash}`;
  }

  // Same file, view switched => that's the user picking a mode.
  ghqol.onUrlChange((href, prevHref) => {
    const cur = parse(href);
    const prev = parse(prevHref);
    if (cur && prev && cur.rest === prev.rest && cur.view !== prev.view) {
      setMode(cur.view);
      return;
    }
    if (cur?.view === "blob" && mode === "blame" && !NO_BLAME.test(cur.rest) && cur.rest !== prev?.rest) {
      location.replace(blameUrl(cur));
    }
  });

  // Rewrite clicks on file links up front so we don't load the Code view first.
  document.addEventListener(
    "click",
    (e) => {
      if (mode !== "blame" || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element && e.target.closest("a[href]");
      if (!a || a.target === "_blank") return;
      const p = parse(a.href);
      if (!p || p.view !== "blob" || NO_BLAME.test(p.rest)) return;
      // A blob link to the file we're already on is the Code/Blame toggle.
      if (parse(location.href)?.rest.split("#")[0] === p.rest) {
        setMode("blob");
        return;
      }
      // Only when browsing from a file/tree page; a blob link in a comment is
      // usually a pointer to specific lines in normal view.
      if (!/^\/[^/]+\/[^/]+\/(blob|blame|tree)\//.test(location.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      location.assign(blameUrl(p));
    },
    true,
  );
});
