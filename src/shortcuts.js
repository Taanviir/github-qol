// Extra `g`-prefixed repo shortcuts, filling gaps in GitHub's own set
// (g c / g i / g p / g a / g w / g g / g s / g n are already taken natively).
//
//   g r  Releases       g t  Tags         g b  Branches
//   g h  Commit history g o  Settings

ghqol.register("shortcuts", () => {
  const TARGETS = {
    r: "releases",
    t: "tags",
    b: "branches",
    h: "commits",
    o: "settings",
  };

  let gPressedAt = 0;

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ghqol.isTyping(e)) return;
      if (e.key === "g") {
        gPressedAt = Date.now();
        return;
      }
      const recent = Date.now() - gPressedAt < 1500;
      gPressedAt = 0;
      const page = TARGETS[e.key];
      if (!recent || !page) return;
      const repo = ghqol.repo();
      if (!repo) return;
      e.preventDefault();
      e.stopPropagation();
      location.assign(`/${repo.owner}/${repo.repo}/${page}`);
    },
    true,
  );
});
