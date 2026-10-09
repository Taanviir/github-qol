# GitHub QoL

Small Chrome extension (Manifest V3, no build step) with quality-of-life tweaks for github.com. Every feature can be switched off from the toolbar popup.

**Website:** https://taanviir.github.io/github-qol/

## Features

| Feature | What it does |
| --- | --- |
| **Image lightbox** | Clicking an image in a PR, issue, comment or README opens it in an in-page popup instead of a new tab. `←` / `→` step through every image on the page, `Esc` closes, and clicking the image toggles full size. Ctrl/Cmd/middle-click still opens a new tab. |
| **GIF player** | Animated GIF/WebP images in the lightbox get pause/play (`Space`), frame-by-frame stepping (`,` / `.`) and 0.25×–2× speed. |
| **Annotate screenshots** | In a comment box, `Ctrl+Shift+V` (`Cmd+Shift+V` on macOS) with a screenshot on the clipboard opens an editor with arrow, box, pen, text and redact tools before attaching. Plain `Ctrl+V` is unchanged. |
| **Diff tools** | "Collapse all" / "Expand all" buttons on Files changed. `v` marks the current file as viewed and jumps to the next unviewed file. |
| **Collapse lockfiles** | Lockfiles, snapshots, minified, source-map and generated files start collapsed, tagged "auto-collapsed". |
| **Absolute dates** | Timestamps older than a day show the date and time ("Oct 3, 2026, 2:20 PM") instead of "last week". |
| **Load all hidden items** | Adds one button on long PRs and issues that keeps clicking "Load more" until the whole timeline is shown. |
| **Clickable file paths** | Inline code like `src/app.ts:42` in comments links to that file and line. It's only linked if the file exists, and on PRs the PR's branch is tried first. |
| **Sticky blame view** | Switch a file to Blame and other files you open stay in Blame until you switch back to Code. |
| **Extra shortcuts** | `g r` releases, `g t` tags, `g b` branches, `g h` commit history, `g o` settings. These fill gaps in GitHub's own `g` shortcuts. |

## Install

1. Download `github-qol.zip` from the [latest release](https://github.com/Taanviir/github-qol/releases/latest) and unzip it
2. Open `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and pick the unzipped `github-qol` folder

To work on it, load this repo folder directly instead. After editing, hit the reload icon on the extension card and refresh the GitHub tab.

## Releasing

1. Bump `version` in `manifest.json`
2. `./scripts/package.sh` builds `dist/github-qol.zip`
3. `gh release create vX.Y.Z dist/github-qol.zip --title vX.Y.Z --notes "..."`

The site's Download links point at `releases/latest/download/github-qol.zip`, so they pick up new releases automatically.

## Layout

- `src/core.js`: shared helpers (settings, DOM-change scanning, URL-change hooks). Loaded first.
- `src/*.js`: one file per feature, each calling `ghqol.register(key, init)`.
- `src/background.js`: fetches image bytes for the GIF player, since content scripts can't read githubusercontent.com directly.
- `scripts/package.sh`: builds the release zip.
- `popup/`: the toggles. Feature keys must match `DEFAULTS` in `core.js`.

## Notes

- Diff tools support both versions of Files changed: the classic page (`/pull/N/files`) and the newer React review page (`/pull/N/changes`) that most signed-in accounts get.
- Clickable file paths sends one HEAD request per candidate path, capped at 60 per page.
