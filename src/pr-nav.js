// Previous / next PR arrow buttons in the PR header, plus [ and ] to use them.
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

  const CHEVRON = {
    [-1]: "M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z",
    1: "M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z",
  };

  // Signed in, the header's action buttons (Merge status, Code) are Primer
  // React buttons with hashed class names; copy one so ours match. Logged
  // out the action area is empty and hidden, so sit next to the title.
  function slot() {
    const actions = document.querySelector("[data-component='PageHeader'] [data-component='PH_Actions']");
    const ref = actions?.querySelector("button[class*='ButtonBase'], a[class*='ButtonBase']");
    if (ref && actions.offsetParent) return { parent: actions, ref };
    const title = document.querySelector("[data-component='PageHeader'] [data-component='TitleArea'], .gh-header-show .gh-header-title");
    return title && { parent: title, ref: null };
  }

  function button(pr, dir, promise, ref) {
    const a = document.createElement("a");
    if (ref) {
      a.className = [...ref.classList].filter((c) => c.includes("ButtonBase")).join(" ");
      for (const attr of ["data-size", "data-variant"]) a.setAttribute(attr, ref.getAttribute(attr) ?? "");
    } else {
      a.className = "btn btn-sm";
    }
    const name = dir < 0 ? "Previous PR" : "Next PR";
    const key = dir < 0 ? "[" : "]";
    a.setAttribute("aria-label", name);
    a.setAttribute("aria-disabled", "true");
    a.title = `${name} (${key})`;
    a.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="${CHEVRON[dir]}"></path></svg>`;
    Object.assign(a.style, {
      display: "inline-grid",
      placeItems: "center",
      padding: "0",
      aspectRatio: "1",
      opacity: "0.5",
      pointerEvents: "none",
      [dir < 0 ? "borderTopRightRadius" : "borderTopLeftRadius"]: "0",
      [dir < 0 ? "borderBottomRightRadius" : "borderBottomLeftRadius"]: "0",
      ...(dir > 0 && { marginLeft: "-1px" }),
    });
    if (!ref) a.style.height = "28px";
    promise.then((n) => {
      if (n == null) {
        a.title = dir < 0 ? "No earlier PR" : "No later PR found";
        return;
      }
      a.href = pr.base + n + pr.tab;
      a.title = `${name} #${n} (${key})`;
      a.setAttribute("aria-label", `${name} #${n}`);
      a.removeAttribute("aria-disabled");
      a.style.opacity = "";
      a.style.pointerEvents = "";
    });
    return a;
  }

  ghqol.onScan(() => {
    const pr = parse();
    const existing = document.querySelector(".ghqol-pr-nav");
    const target = pr && slot();
    if (existing && existing.dataset.pr === String(pr?.number) && existing.parentElement === target?.parent) return;
    existing?.remove();
    if (!target) return;
    const { prev, next } = lookup(pr);
    const nav = document.createElement("span");
    nav.className = "ghqol-pr-nav";
    nav.dataset.pr = pr.number;
    Object.assign(nav.style, { display: "inline-flex", alignSelf: "center", flexShrink: "0" });
    if (!target.ref) nav.style.marginLeft = "12px";
    nav.append(button(pr, -1, prev, target.ref), button(pr, 1, next, target.ref));
    target.parent.append(nav);
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
