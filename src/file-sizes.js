// Shows each file's size in the repo file list, so you can see it before
// opening the file. GitHub's list data has no sizes, so the background script
// reads each one from the file's /raw/ link.

ghqol.register("fileSizes", () => {
  const MAX_PER_PAGE = 300;

  const cache = new Map(); // raw path -> Promise<number|null>
  let requests = 0;
  let active = 0;
  const queue = [];

  function pump() {
    while (active < 6 && queue.length) {
      active++;
      queue.shift()().finally(() => {
        active--;
        pump();
      });
    }
  }

  function size(rawPath) {
    if (!cache.has(rawPath)) {
      if (requests >= MAX_PER_PAGE) return Promise.resolve(null);
      requests++;
      cache.set(
        rawPath,
        new Promise((resolve) => {
          queue.push(() =>
            chrome.runtime
              .sendMessage({ type: "file-size", url: rawPath })
              .then((res) => resolve(res?.ok ? res.bytes : null), () => resolve(null)),
          );
          pump();
        }),
      );
    }
    return cache.get(rawPath);
  }

  // Same style as GitHub's own file header ("1.01 KB").
  function format(bytes) {
    if (bytes < 1024) return `${bytes} Bytes`;
    const units = ["KB", "MB", "GB"];
    let n = bytes / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(2)} ${units[i]}`;
  }

  ghqol.onUrlChange(() => {
    requests = 0;
  });

  ghqol.onScan(() => {
    if (!ghqol.repo()) return;
    // The list renders the name twice (small and large screen layouts).
    for (const a of document.querySelectorAll("tr.react-directory-row .react-directory-filename-cell a[href*='/blob/']")) {
      const column = a.closest(".react-directory-filename-column");
      if (!column || column.querySelector(".ghqol-size")) continue;
      const span = document.createElement("span");
      span.className = "ghqol-size color-fg-muted f6";
      Object.assign(span.style, { marginLeft: "auto", paddingLeft: "8px", whiteSpace: "nowrap" });
      column.appendChild(span);
      size(new URL(a.href).pathname.replace("/blob/", "/raw/")).then((bytes) => {
        if (bytes != null) span.textContent = format(bytes);
      });
    }
  });
});
