// Previous / next PR buttons next to the PR title, plus [ and ] to use them.
// PR and issue numbers share one sequence, so neighbours are found by asking
// /pull/K for each number: a PR answers 200, an issue (or a missing number)
// redirects. Keeps the current tab, so Files changed goes to Files changed.

ghqol.register("prNav", () => {
  const MAX_STEPS = 50;
  const BATCH = 10;

  const cache = new Map(); // "owner/repo#N" -> Promise<boolean>

  function parse() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(\/.*)?$/);
    if (!m || !ghqol.repo()) return null;
    return { base: `/${m[1]}/${m[2]}/pull/`, number: Number(m[3]), tab: m[4] ?? "" };
  }

  function isPull(base, n) {
    const key = base + n;
    if (!cache.has(key)) {
      cache.set(
        key,
        fetch(key, { method: "HEAD", redirect: "manual", credentials: "same-origin" }).then(
          (res) => res.status === 200,
          () => false,
        ),
      );
    }
    return cache.get(key);
  }

  async function neighbour(pr, dir) {
    for (let start = pr.number + dir, steps = 0; steps < MAX_STEPS && start >= 1; start += dir * BATCH, steps += BATCH) {
      const nums = [];
      for (let k = start; nums.length < BATCH && k >= 1; k += dir) nums.push(k);
      const hits = await Promise.all(nums.map((k) => isPull(pr.base, k)));
      const i = hits.indexOf(true);
      if (i !== -1) return nums[i];
    }
    return null;
  }

  // Resolved once per PR page; the buttons and keys share the result.
  let current = null; // { url, prev: Promise, next: Promise }

  function lookup(pr) {
    if (current?.url !== pr.base + pr.number) {
      current = { url: pr.base + pr.number, prev: neighbour(pr, -1), next: neighbour(pr, 1) };
    }
    return current;
  }

  async function go(dir) {
    const pr = parse();
    if (!pr) return;
    const n = await lookup(pr)[dir < 0 ? "prev" : "next"];
    if (n == null) return ghqol.toast(dir < 0 ? "No earlier PR" : "No later PR found");
    location.assign(pr.base + n + pr.tab);
  }

  function button(pr, label, dir, promise) {
    const a = document.createElement("a");
    a.className = "btn btn-sm";
    a.textContent = label;
    a.setAttribute("aria-disabled", "true");
    a.title = dir < 0 ? "Previous PR  [" : "Next PR  ]";
    promise.then((n) => {
      if (n == null) return;
      a.href = pr.base + n + pr.tab;
      a.textContent = dir < 0 ? `‹ #${n}` : `#${n} ›`;
      a.removeAttribute("aria-disabled");
    });
    return a;
  }

  ghqol.onScan(() => {
    const pr = parse();
    const existing = document.querySelector(".ghqol-pr-nav");
    if (existing && existing.dataset.pr === String(pr?.number)) return;
    existing?.remove();
    if (!pr) return;
    const title = document.querySelector("[data-component='PageHeader'] [data-component='TitleArea'], .gh-header-show .gh-header-title");
    if (!title) return;
    const { prev, next } = lookup(pr);
    const nav = document.createElement("span");
    nav.className = "ghqol-pr-nav BtnGroup";
    nav.dataset.pr = pr.number;
    Object.assign(nav.style, { marginLeft: "12px", alignSelf: "center", whiteSpace: "nowrap", flexShrink: "0" });
    nav.append(button(pr, "‹ Prev", -1, prev), button(pr, "Next ›", 1, next));
    title.append(nav);
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ghqol.isTyping(e)) return;
      if (e.key !== "[" && e.key !== "]") return;
      if (!parse()) return;
      e.preventDefault();
      e.stopPropagation();
      go(e.key === "[" ? -1 : 1);
    },
    true,
  );
});
