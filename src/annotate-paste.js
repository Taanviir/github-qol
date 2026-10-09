// Ctrl+Shift+V (Cmd+Shift+V on macOS) with a screenshot on the clipboard,
// inside a GitHub comment box, opens a quick annotator: arrows, boxes, pen,
// text and redaction. "Attach" uploads the result just like a normal paste.
// Plain Ctrl+V is untouched.
//
// Chrome strips images from "paste as plain text" events, so we read the
// clipboard ourselves (the `clipboardRead` permission avoids a prompt).

ghqol.register("annotatePaste", () => {
  let armed = null; // { at, target }

  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "v") {
        const t = e.target;
        armed = t instanceof HTMLTextAreaElement ? { at: Date.now(), target: t } : null;
      }
    },
    true,
  );

  document.addEventListener(
    "paste",
    (e) => {
      const arm = armed;
      armed = null;
      if (!arm || arm.target !== e.target || Date.now() - arm.at > 1000) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openAnnotator(file, arm.target);
        return;
      }
      // Text on the clipboard: let the plain-text paste happen.
      if (e.clipboardData?.types.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      readClipboardImage().then(
        (blob) => (blob ? openAnnotator(blob, arm.target) : ghqol.toast("No image on the clipboard")),
        (err) => {
          console.warn("[GitHub QoL] clipboard read failed:", err);
          ghqol.toast("Couldn't read the clipboard");
        },
      );
    },
    true,
  );

  async function readClipboardImage() {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return item.getType(type);
    }
    return null;
  }

  // ---------- annotator ----------

  const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#000000"];
  const TOOLS = [
    ["arrow", "Arrow", "A"],
    ["rect", "Box", "R"],
    ["pen", "Pen", "P"],
    ["text", "Text", "T"],
    ["redact", "Redact", "X"],
  ];

  const STYLE = `
    :host { all: initial; }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(1, 4, 9, 0.92);
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: #e6edf3;
    }
    .toolbar {
      position: absolute; top: 0; left: 0; right: 0; height: 56px;
      display: flex; align-items: center; gap: 6px; padding: 0 16px;
    }
    .sep { width: 1px; height: 24px; background: #3d444d; margin: 0 6px; }
    .spacer { flex: 1; }
    button {
      all: unset; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      height: 32px; min-width: 32px; padding: 0 10px; box-sizing: border-box;
      border-radius: 6px; border: 1px solid #3d444d;
      background: #212830; color: #e6edf3;
    }
    button:hover { background: #2a313c; border-color: #656c76; }
    button:focus-visible { outline: 2px solid #1f6feb; outline-offset: 1px; }
    button[aria-pressed="true"] { background: #1f6feb; border-color: #1f6feb; }
    button.primary { background: #238636; border-color: #2ea043; font-weight: 600; }
    button.primary:hover { background: #2ea043; }
    kbd { font: 11px ui-monospace, monospace; color: #9198a1; }
    button[aria-pressed="true"] kbd { color: #cfe2ff; }
    .swatch { width: 22px; height: 22px; min-width: 0; padding: 0; border-radius: 50%; border: 2px solid #3d444d; }
    .swatch[aria-pressed="true"] { border-color: #fff; box-shadow: 0 0 0 2px #1f6feb; }
    .stage {
      position: absolute; inset: 56px 24px 24px;
      display: flex; align-items: center; justify-content: center;
    }
    canvas {
      max-width: 100%; max-height: 100%;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
      cursor: crosshair; touch-action: none;
    }
    input.text {
      position: fixed; z-index: 1;
      background: rgba(0,0,0,.6); border: 1px dashed #fff; outline: none;
      color: #fff; padding: 2px 4px; font-weight: 700;
    }
  `;

  function openAnnotator(blob, textarea) {
    const host = document.createElement("div");
    host.id = "ghqol-annotator";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="backdrop" role="dialog" aria-modal="true" aria-label="Annotate screenshot">
        <div class="toolbar">
          ${TOOLS.map(([id, label, key]) => `<button class="tool" data-tool="${id}" title="${label} (${key})">${label} <kbd>${key}</kbd></button>`).join("")}
          <span class="sep"></span>
          ${COLORS.map((c) => `<button class="swatch" data-color="${c}" style="background:${c}" title="${c}" aria-label="Color ${c}"></button>`).join("")}
          <span class="sep"></span>
          <button class="undo" title="Undo (Ctrl+Z)">Undo</button>
          <span class="spacer"></span>
          <button class="cancel" title="Cancel (Esc)">Cancel</button>
          <button class="attach primary" title="Attach to comment (Ctrl+Enter)">Attach</button>
        </div>
        <div class="stage"><canvas></canvas></div>
      </div>
    `;
    const $ = (s) => root.querySelector(s);
    const canvas = $("canvas");
    const ctx = canvas.getContext("2d");
    const ops = [];
    let tool = "arrow";
    let color = COLORS[0];
    let draft = null;
    let base = null;
    let lineWidth = 4;
    let textInput = null;

    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.appendChild(host);

    createImageBitmap(blob).then((bmp) => {
      base = bmp;
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      lineWidth = Math.max(3, Math.round(Math.max(bmp.width, bmp.height) / 300));
      redraw();
    });

    function setTool(t) {
      commitText();
      tool = t;
      root.querySelectorAll(".tool").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
    }
    function setColor(c) {
      color = c;
      root.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === c)));
    }
    setTool(tool);
    setColor(color);

    root.querySelectorAll(".tool").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
    root.querySelectorAll(".swatch").forEach((b) => b.addEventListener("click", () => setColor(b.dataset.color)));
    $(".undo").addEventListener("click", undo);
    $(".cancel").addEventListener("click", close);
    $(".attach").addEventListener("click", attach);

    function undo() {
      ops.pop();
      redraw();
    }

    function toCanvas(e) {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (!base) return;
      const p = toCanvas(e);
      if (tool === "text") {
        e.preventDefault();
        startText(e, p);
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      draft = { type: tool, color, w: lineWidth, x1: p.x, y1: p.y, x2: p.x, y2: p.y, points: [p] };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!draft) return;
      const p = toCanvas(e);
      draft.x2 = p.x;
      draft.y2 = p.y;
      if (draft.type === "pen") draft.points.push(p);
      redraw();
    });
    canvas.addEventListener("pointerup", () => {
      if (!draft) return;
      const tiny = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 4 && draft.type !== "pen";
      if (!tiny) ops.push(draft);
      draft = null;
      redraw();
    });

    function startText(e, p) {
      commitText();
      const scale = canvas.getBoundingClientRect().width / canvas.width;
      const size = lineWidth * 6;
      textInput = document.createElement("input");
      textInput.className = "text";
      Object.assign(textInput.style, {
        left: `${e.clientX}px`,
        top: `${e.clientY - (size * scale) / 2}px`,
        fontSize: `${size * scale}px`,
        color,
      });
      textInput.dataset.x = p.x;
      textInput.dataset.y = p.y;
      textInput.dataset.color = color;
      textInput.dataset.size = size;
      $(".backdrop").appendChild(textInput);
      textInput.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") commitText();
        if (ev.key === "Escape") {
          textInput.remove();
          textInput = null;
        }
      });
      // Focus after this pointerdown finishes so it isn't stolen back.
      setTimeout(() => textInput?.focus());
    }

    function commitText() {
      if (!textInput) return;
      const { x, y, color: c, size } = textInput.dataset;
      const text = textInput.value.trim();
      textInput.remove();
      textInput = null;
      if (text) {
        ops.push({ type: "text", text, x: Number(x), y: Number(y), color: c, size: Number(size) });
        redraw();
      }
    }

    function redraw() {
      if (!base) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      for (const op of draft ? [...ops, draft] : ops) drawOp(op);
    }

    function drawOp(op) {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = op.color;
      ctx.lineWidth = op.w;
      ctx.lineCap = ctx.lineJoin = "round";
      // Dark halo keeps light colors readable on light screenshots.
      if (op.type !== "redact") {
        ctx.shadowColor = "rgba(0,0,0,.45)";
        ctx.shadowBlur = op.w ? op.w * 1.5 : 4;
      }
      switch (op.type) {
        case "rect":
          ctx.strokeRect(op.x1, op.y1, op.x2 - op.x1, op.y2 - op.y1);
          break;
        case "redact":
          ctx.fillStyle = "#000";
          ctx.fillRect(op.x1, op.y1, op.x2 - op.x1, op.y2 - op.y1);
          break;
        case "pen":
          ctx.beginPath();
          op.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
          ctx.stroke();
          break;
        case "arrow": {
          const angle = Math.atan2(op.y2 - op.y1, op.x2 - op.x1);
          const head = op.w * 4;
          const bx = op.x2 - head * 0.8 * Math.cos(angle);
          const by = op.y2 - head * 0.8 * Math.sin(angle);
          ctx.beginPath();
          ctx.moveTo(op.x1, op.y1);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(op.x2, op.y2);
          ctx.lineTo(op.x2 - head * Math.cos(angle - 0.45), op.y2 - head * Math.sin(angle - 0.45));
          ctx.lineTo(op.x2 - head * Math.cos(angle + 0.45), op.y2 - head * Math.sin(angle + 0.45));
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "text":
          ctx.font = `700 ${op.size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
          ctx.textBaseline = "middle";
          ctx.fillText(op.text, op.x, op.y);
          break;
      }
      ctx.restore();
    }

    function onKey(e) {
      // e.target is retargeted to the shadow host; check the real target.
      if (textInput && e.composedPath()[0] === textInput) return;
      e.stopPropagation();
      const k = e.key.toLowerCase();
      if (e.key === "Escape") close();
      else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") attach();
      else if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        undo();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = TOOLS.find(([, , key]) => key.toLowerCase() === k);
        if (t) setTool(t[0]);
      }
    }
    document.addEventListener("keydown", onKey, true);

    function close() {
      document.removeEventListener("keydown", onKey, true);
      document.documentElement.style.overflow = prevOverflow;
      host.remove();
      base?.close();
      textarea.focus();
    }

    async function attach() {
      commitText();
      if (!base) return;
      draft = null;
      redraw();
      const out = await new Promise((r) => canvas.toBlob(r, "image/png"));
      close();
      const file = new File([out], `screenshot-${Date.now()}.png`, { type: "image/png" });
      if (insertFile(textarea, file)) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": out })]);
        ghqol.toast("Couldn't attach automatically. Annotated image copied, press Ctrl+V");
      } catch {
        ghqol.toast("Couldn't attach the image");
      }
    }
  }

  // Hand the file to GitHub's upload handler the way a real paste or drop
  // would. Returns true if something on the page handled it.
  function insertFile(textarea, file) {
    textarea.focus();
    const paste = new DataTransfer();
    paste.items.add(file);
    const pasteEvent = new ClipboardEvent("paste", { clipboardData: paste, bubbles: true, cancelable: true });
    textarea.dispatchEvent(pasteEvent);
    if (pasteEvent.defaultPrevented) return true;
    const drop = new DataTransfer();
    drop.items.add(file);
    const dropEvent = new DragEvent("drop", { dataTransfer: drop, bubbles: true, cancelable: true });
    textarea.dispatchEvent(dropEvent);
    return dropEvent.defaultPrevented;
  }
});
