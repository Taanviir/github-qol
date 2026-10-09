const FEATURES = [
  ["imageLightbox", "Image lightbox", "Open comment images in a popup. <kbd>←</kbd> <kbd>→</kbd> browse, GIFs get pause and frame-by-frame (<kbd>Space</kbd> <kbd>,</kbd> <kbd>.</kbd>)."],
  ["annotatePaste", "Annotate screenshots", "<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> in a comment box to mark up a screenshot before it's attached."],
  ["diffTools", "Diff tools", "Collapse / expand all buttons on Files changed. <kbd>v</kbd> marks the file viewed and jumps to the next."],
  ["hideNoisyDiffs", "Collapse lockfiles", "Lockfiles, snapshots, minified and generated files start collapsed."],
  ["absoluteDates", "Absolute dates", "Anything older than a day shows the date and time instead of \"last week\"."],
  ["expandTimeline", "Load all hidden items", "One button to load every hidden comment on long PRs and issues."],
  ["linkifyPaths", "Clickable file paths", "<code>src/app.ts:42</code> in comments links to the file (only if it exists)."],
  ["stickyBlame", "Sticky blame view", "Once you switch a file to Blame, other files you open stay in Blame."],
  ["shortcuts", "Extra shortcuts", "<kbd>g</kbd> then <kbd>r</kbd> releases, <kbd>t</kbd> tags, <kbd>b</kbd> branches, <kbd>h</kbd> commits, <kbd>o</kbd> settings."],
];

const DEFAULTS = Object.fromEntries(FEATURES.map(([key]) => [key, true]));
const list = document.getElementById("features");

chrome.storage.sync.get(DEFAULTS).then((settings) => {
  for (const [key, name, desc] of FEATURES) {
    const li = document.createElement("li");
    li.innerHTML = `
      <label for="${key}"><span class="name">${name}</span><span class="desc">${desc}</span></label>
      <input type="checkbox" id="${key}" role="switch">
    `;
    const input = li.querySelector("input");
    input.checked = settings[key];
    input.addEventListener("change", () => {
      chrome.storage.sync.set({ [key]: input.checked });
      document.getElementById("note").hidden = false;
    });
    list.appendChild(li);
  }
});
