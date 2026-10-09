// Turns inline code that names a file in the repo — `src/app.ts`,
// `README.md`, `.github/workflows/ci.yml`, `lib/foo.rb:42`, `lib/foo.rb:10-20` — into a link to that file.
//
// Every candidate is checked with a HEAD request first, so `obj.method` or
// `@scope/pkg` never become broken links. On PR pages the PR's head branch is
// tried first, so files added by the PR resolve too.

ghqol.register("linkifyPaths", () => {
  const PATH_RE =
    /^(?:\.\/)?((?:[\w@.+-]+\/)*[\w@.+-][\w@.+-]*\.[A-Za-z][\w]{0,7}|(?:[\w@.+-]+\/)+[\w@.+-]*)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L(\d+))?)?$/;
  // A bare name without a slash must look like a real file name, otherwise
  // things like `obj.method` would each cost a request.
  const BARE_FILE_RE =
    /(^|\/)[^/]*\.(json|ya?ml|toml|lock|md|mdx|txt|js|mjs|cjs|jsx|ts|mts|cts|tsx|vue|svelte|css|scss|less|html|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|sql|xml|gradle|env|ini|cfg|conf|properties|proto|graphql|tf|dockerfile)$|^(Dockerfile|Makefile|Procfile|Gemfile|Rakefile|LICENSE|README|CHANGELOG)(\.\w+)?$/i;
  const MAX_CHECKS_PER_PAGE = 60;

  const cache = new Map(); // candidate url -> Promise<string|null> (resolved url)
  let checks = 0;
  let active = 0;
  const queue = [];

  function limited(fn) {
    return new Promise((resolve) => {
      queue.push(() => fn().then(resolve, () => resolve(null)));
      pump();
    });
  }

  function pump() {
    while (active < 4 && queue.length) {
      active++;
      queue.shift()().finally(() => {
        active--;
        pump();
      });
    }
  }

  function exists(url) {
    if (!cache.has(url)) {
      if (checks >= MAX_CHECKS_PER_PAGE) return Promise.resolve(null);
      checks++;
      cache.set(
        url,
        limited(async () => {
          const res = await fetch(url, { method: "HEAD", credentials: "same-origin" });
          if (!res.ok) return null;
          // Directories redirect to /tree/<sha>/...; keep the ref we asked for.
          return res.redirected && new URL(res.url).pathname.includes("/tree/") ? url.replace("/blob/", "/tree/") : url;
        }),
      );
    }
    return cache.get(url);
  }

  function refBases(repo) {
    const bases = [];
    const head = document.querySelector(".head-ref a[href*='/tree/']")?.getAttribute("href");
    if (head && /\/pull\/\d+/.test(location.pathname)) bases.push(head.replace("/tree/", "/blob/"));
    bases.push(`/${repo.owner}/${repo.repo}/blob/HEAD`);
    return bases;
  }

  async function resolve(path, repo) {
    for (const base of refBases(repo)) {
      const url = await exists(`${base}/${path.split("/").map(encodeURIComponent).join("/")}`);
      if (url) return url;
    }
    return null;
  }

  ghqol.onUrlChange(() => {
    checks = 0;
  });

  ghqol.onScan(() => {
    const repo = ghqol.repo();
    if (!repo) return;
    for (const code of document.querySelectorAll(".markdown-body code:not([data-ghqol-path])")) {
      code.dataset.ghqolPath = "";
      if (code.closest("pre, a")) continue;
      const m = code.textContent.trim().match(PATH_RE);
      if (!m) continue;
      const [, path, l1, l2, h1, h2] = m;
      if (!path.includes("/") && !BARE_FILE_RE.test(path)) continue;
      const start = l1 ?? h1;
      const end = l2 ?? h2;
      resolve(path.replace(/\/$/, ""), repo).then((url) => {
        if (!url || !code.isConnected || code.closest("a")) return;
        const a = document.createElement("a");
        a.href = url + (start ? `#L${start}${end ? `-L${end}` : ""}` : "");
        a.title = "Open file (GitHub QoL)";
        code.replaceWith(a);
        a.appendChild(code);
      });
    }
  });
});
