// Content scripts are bound by github.com's CORS rules, so they can't read the
// bytes of images served from githubusercontent.com. The lightbox needs those
// bytes to decode GIF frames, so it asks us to fetch them instead.

const ALLOWED_HOSTS = [
  "github.com",
  "camo.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "user-images.githubusercontent.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
];

const MAX_BYTES = 40 * 1024 * 1024;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "fetch-image") return;
  fetchImage(msg.url).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // async response
});

async function fetchImage(url) {
  const { hostname, protocol } = new URL(url);
  if (protocol !== "https:" || !ALLOWED_HOSTS.includes(hostname)) {
    return { ok: false, error: `Host not allowed: ${hostname}` };
  }
  // github.com/user-attachments links need the session to resolve private assets.
  const res = await fetch(url, { credentials: hostname === "github.com" ? "include" : "omit" });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return { ok: false, error: "Image too large" };
  return { ok: true, base64: toBase64(buf) };
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
