// Opens images in rendered markdown (PR/issue comments, READMEs, etc.) in an
// in-page lightbox instead of following GitHub's target="_blank" link.
//
// Ctrl/Cmd/Shift/middle-click still behave normally, so you can open the
// original in a new tab when you actually want to.
//
// Animated images (GIF, animated WebP/PNG) get a frame player: pause, step
// frame by frame, change speed. Frames come from the WebCodecs ImageDecoder;
// the bytes are fetched by the background worker (see background.js).

ghqol.register("imageLightbox", () => {
  const MARKDOWN_SELECTOR = ".markdown-body, .comment-body, .js-comment-body";

  const IMAGE_HOSTS = new Set([
    "private-user-images.githubusercontent.com",
    "user-images.githubusercontent.com",
    "camo.githubusercontent.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
  ]);

  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)(\?|#|$)/i;
  const ANIMATED_EXT = /\.(gif|webp|apng)$/i;
  const STATIC_EXT = /\.(png|jpe?g|svg|bmp|avif|ico)$/i;

  // GitHub wraps every markdown image in a link to the image itself. We only
  // hijack those, not images the author deliberately linked elsewhere
  // (e.g. a CI badge linking to the build page).
  function isImageLink(anchor, img) {
    let url;
    try {
      url = new URL(anchor.href, location.href);
    } catch {
      return false;
    }
    const href = url.href;
    if (href === img.src || href === img.currentSrc) return true;
    const canonical = img.getAttribute("data-canonical-src");
    if (canonical && href === new URL(canonical, location.href).href) return true;
    if (IMAGE_HOSTS.has(url.hostname)) return true;
    if (url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/assets/")) return true;
    if (url.hostname === "github.com" && url.pathname.includes("/raw/")) return true;
    return IMAGE_EXT.test(url.pathname);
  }

  function lightboxTarget(el) {
    const img = el.closest("img");
    if (!img) return null;
    const anchor = img.closest("a[href]");
    if (!anchor || !anchor.closest(MARKDOWN_SELECTOR)) return null;
    if (img.closest("g-emoji") || img.classList.contains("emoji")) return null;
    return isImageLink(anchor, img) ? { img, anchor } : null;
  }

  function collectGallery() {
    const items = [];
    for (const img of document.querySelectorAll(`:is(${MARKDOWN_SELECTOR}) a[href] img`)) {
      const t = lightboxTarget(img);
      if (t && !items.some((i) => i.img === img)) items.push(t);
    }
    return items;
  }

  // Camo URLs hex-encode the original URL in their last path segment.
  function decodeCamo(src) {
    try {
      const url = new URL(src);
      if (url.hostname !== "camo.githubusercontent.com") return "";
      const hex = url.pathname.split("/").pop();
      return decodeURIComponent(hex.replace(/(..)/g, "%$1"));
    } catch {
      return "";
    }
  }

  // Worth fetching the bytes to look for frames? Yes for GIF/WebP, and for
  // extension-less URLs like /user-attachments/assets/<uuid>.
  function maybeAnimated({ img, anchor }) {
    if (img.closest("animated-image")) return true;
    const src = img.currentSrc || img.src;
    const paths = [src, anchor.href, img.getAttribute("data-canonical-src") || "", decodeCamo(src)]
      .map((u) => {
        try {
          return new URL(u, location.href).pathname;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    if (paths.some((p) => ANIMATED_EXT.test(p))) return true;
    return !paths.some((p) => STATIC_EXT.test(p));
  }

  function sniffType(bytes) {
    const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
    if (ascii(0, 4) === "GIF8") return "image/gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
    return null;
  }

  // ---------- UI ----------

  const STYLE = `
    :host { all: initial; }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(1, 4, 9, 0.92);
      backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: #e6edf3;
    }
    .stage {
      position: absolute; inset: 56px 64px 48px;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .stage.zoomed { overflow: auto; display: block; text-align: center; }
    .media {
      max-width: 100%; max-height: 100%;
      object-fit: contain;
      border-radius: 6px;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
      background: repeating-conic-gradient(#2d333b 0% 25%, #22272e 0% 50%) 50% / 16px 16px;
      cursor: zoom-in;
    }
    .stage.zoomed .media { max-width: none; max-height: none; cursor: zoom-out; }
    .bar {
      position: absolute; top: 0; left: 0; right: 0; height: 56px;
      display: flex; align-items: center; gap: 8px; padding: 0 16px;
    }
    .caption {
      flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: #9198a1;
    }
    button, a.btn, select {
      all: unset; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      height: 32px; min-width: 32px; padding: 0 10px; box-sizing: border-box;
      border-radius: 6px; border: 1px solid #3d444d;
      background: #212830; color: #e6edf3; font-size: 13px;
    }
    button:hover, a.btn:hover, select:hover { background: #2a313c; border-color: #656c76; }
    button:focus-visible, a.btn:focus-visible, select:focus-visible { outline: 2px solid #1f6feb; outline-offset: 1px; }
    .nav {
      position: absolute; top: 50%; transform: translateY(-50%);
      height: 48px; width: 40px; font-size: 22px; padding: 0;
    }
    .prev { left: 12px; }
    .next { right: 12px; }
    .footer {
      position: absolute; bottom: 0; left: 0; right: 0; height: 48px;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      color: #656c76; font-size: 12px;
    }
    .player { display: flex; align-items: center; gap: 6px; color: #9198a1; }
    .player .frame { min-width: 96px; text-align: center; font-variant-numeric: tabular-nums; }
    .player button { height: 28px; min-width: 28px; padding: 0 8px; }
    .player select { height: 28px; padding: 0 8px; }
    [hidden] { display: none !important; }
  `;

  let host = null;
  let state = null; // { items, index, ui, returnFocus, player, loadToken }

  function buildUI() {
    host = document.createElement("div");
    host.id = "ghqol-lightbox";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="backdrop" role="dialog" aria-modal="true" aria-label="Image viewer">
        <div class="bar">
          <span class="counter"></span>
          <span class="caption"></span>
          <a class="btn open" target="_blank" rel="noopener noreferrer" title="Open original in new tab">Open original ↗</a>
          <button class="close" title="Close (Esc)" aria-label="Close">✕</button>
        </div>
        <div class="stage"><img class="media" alt=""><canvas class="media" hidden></canvas></div>
        <button class="nav prev" title="Previous (←)" aria-label="Previous image">‹</button>
        <button class="nav next" title="Next (→)" aria-label="Next image">›</button>
        <div class="footer">
          <span class="hint">Click image to toggle full size · ← → to navigate · Esc to close</span>
          <div class="player" hidden>
            <button class="step-back" title="Previous frame (,)" aria-label="Previous frame">⏮</button>
            <button class="play" title="Play / pause (Space)" aria-label="Play or pause">⏸</button>
            <button class="step-fwd" title="Next frame (.)" aria-label="Next frame">⏭</button>
            <span class="frame"></span>
            <select class="speed" title="Playback speed" aria-label="Playback speed">
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1" selected>1×</option>
              <option value="2">2×</option>
            </select>
          </div>
        </div>
      </div>
    `;
    const $ = (s) => root.querySelector(s);
    const ui = {
      backdrop: $(".backdrop"),
      stage: $(".stage"),
      img: $(".stage img"),
      canvas: $(".stage canvas"),
      counter: $(".counter"),
      caption: $(".caption"),
      open: $(".open"),
      close: $(".close"),
      prev: $(".prev"),
      next: $(".next"),
      hint: $(".hint"),
      player: $(".player"),
      play: $(".play"),
      stepBack: $(".step-back"),
      stepFwd: $(".step-fwd"),
      frame: $(".frame"),
      speed: $(".speed"),
    };

    ui.backdrop.addEventListener("click", (e) => {
      // Clicks on empty space (backdrop, stage padding, bar) close the viewer.
      if (e.target === ui.backdrop || e.target === ui.stage || e.target.classList.contains("bar")) close();
    });
    ui.close.addEventListener("click", close);
    ui.prev.addEventListener("click", () => step(-1));
    ui.next.addEventListener("click", () => step(1));
    ui.img.addEventListener("click", toggleZoom);
    ui.canvas.addEventListener("click", toggleZoom);
    ui.play.addEventListener("click", () => state.player?.toggle());
    ui.stepBack.addEventListener("click", () => state.player?.step(-1));
    ui.stepFwd.addEventListener("click", () => state.player?.step(1));
    ui.speed.addEventListener("change", () => state.player?.setSpeed(Number(ui.speed.value)));
    return ui;
  }

  function show() {
    const { items, index, ui } = state;
    const item = items[index];
    const { img, anchor } = item;
    state.player?.destroy();
    state.player = null;
    ui.stage.classList.remove("zoomed");
    ui.canvas.hidden = true;
    ui.img.hidden = false;
    ui.player.hidden = true;
    ui.hint.hidden = false;
    // currentSrc is the already-loaded (and, for private repos, already-signed) URL.
    ui.img.src = img.currentSrc || img.src;
    ui.img.alt = img.alt || "";
    ui.caption.textContent = img.alt || "";
    ui.open.href = anchor.href;
    const multi = items.length > 1;
    ui.counter.textContent = multi ? `${index + 1} / ${items.length}` : "";
    ui.prev.hidden = ui.next.hidden = !multi;
    if (maybeAnimated(item) && "ImageDecoder" in window) {
      loadPlayer(ui.img.src).catch((err) => console.warn("[GitHub QoL] frame player unavailable:", err));
    }
  }

  async function loadPlayer(src) {
    const token = (state.loadToken = {});
    const res = await chrome.runtime.sendMessage({ type: "fetch-image", url: src });
    if (!state || state.loadToken !== token) return;
    if (!res?.ok) throw new Error(res?.error || "fetch failed");
    const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
    // Don't trust content-type: raw.githubusercontent.com serves text/plain.
    const type = sniffType(bytes);
    if (!type || !(await ImageDecoder.isTypeSupported(type))) return;
    const decoder = new ImageDecoder({ data: bytes, type });
    await decoder.tracks.ready;
    await decoder.completed;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (!state || state.loadToken !== token || frameCount < 2) {
      decoder.close();
      return;
    }
    state.player = createPlayer(decoder, frameCount, state.ui);
  }

  function createPlayer(decoder, frameCount, ui) {
    const ctx = ui.canvas.getContext("2d");
    let index = 0;
    let playing = true;
    let speed = Number(ui.speed.value);
    let timer = null;
    let destroyed = false;
    let renderSeq = 0;

    async function render(i) {
      const seq = ++renderSeq;
      const { image } = await decoder.decode({ frameIndex: i });
      if (destroyed || seq !== renderSeq) {
        image.close();
        return null;
      }
      if (ui.canvas.width !== image.displayWidth || ui.canvas.height !== image.displayHeight) {
        ui.canvas.width = image.displayWidth;
        ui.canvas.height = image.displayHeight;
      }
      ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
      ctx.drawImage(image, 0, 0);
      // Browsers play 0-delay GIF frames at ~100ms; match that.
      const ms = (image.duration ?? 0) / 1000;
      image.close();
      index = i;
      ui.frame.textContent = `frame ${i + 1} / ${frameCount}`;
      return ms >= 20 ? ms : 100;
    }

    async function tick() {
      const ms = await render(index);
      if (ms === null || destroyed || !playing) return;
      timer = setTimeout(() => {
        index = (index + 1) % frameCount;
        tick();
      }, ms / speed);
    }

    function setPlaying(p) {
      playing = p;
      ui.play.textContent = p ? "⏸" : "▶";
      clearTimeout(timer);
      if (p) tick();
    }

    ui.img.hidden = true;
    ui.canvas.hidden = false;
    ui.hint.hidden = true;
    ui.player.hidden = false;
    setPlaying(true);

    return {
      toggle: () => setPlaying(!playing),
      step(delta) {
        setPlaying(false);
        // Update synchronously so rapid key presses each advance a frame.
        index = (index + delta + frameCount) % frameCount;
        render(index);
      },
      setSpeed(s) {
        speed = s;
      },
      destroy() {
        destroyed = true;
        clearTimeout(timer);
        decoder.close();
      },
    };
  }

  function step(delta) {
    if (!state || state.items.length < 2) return;
    state.index = (state.index + delta + state.items.length) % state.items.length;
    show();
  }

  function toggleZoom(e) {
    const { stage } = state.ui;
    const media = e.currentTarget;
    const w = media.naturalWidth ?? media.width;
    const h = media.naturalHeight ?? media.height;
    // Nothing to gain from zooming an image that already fits.
    const fits = w <= stage.clientWidth && h <= stage.clientHeight;
    if (fits && !stage.classList.contains("zoomed")) return;
    stage.classList.toggle("zoomed");
  }

  let prevOverflow = "";

  function open(target) {
    const items = collectGallery();
    let index = items.findIndex((i) => i.img === target.img);
    if (index === -1) {
      items.unshift(target);
      index = 0;
    }
    const ui = buildUI();
    state = { items, index, ui, returnFocus: document.activeElement, player: null, loadToken: null };
    document.body.appendChild(host);
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKey, true);
    show();
    ui.close.focus({ preventScroll: true });
  }

  function close() {
    if (!state) return;
    state.player?.destroy();
    document.removeEventListener("keydown", onKey, true);
    document.documentElement.style.overflow = prevOverflow;
    host.remove();
    const { returnFocus } = state;
    host = null;
    state = null;
    returnFocus?.focus?.({ preventScroll: true });
  }

  function onKey(e) {
    // Keep GitHub's own hotkeys (e.g. "j"/"k", "/") from firing underneath.
    e.stopPropagation();
    const player = state.player;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "ArrowLeft":
        e.preventDefault();
        step(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        step(1);
        break;
      case " ":
        if (player) {
          e.preventDefault();
          player.toggle();
        }
        break;
      case ",":
        player?.step(-1);
        break;
      case ".":
        player?.step(1);
        break;
    }
  }

  document.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element)) return;
      const target = lightboxTarget(e.target);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      open(target);
    },
    true,
  );

  ghqol.onUrlChange(close);
});
