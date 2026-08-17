"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  ticker: $("ticker"), interval: $("interval"), size: $("size"),
  theme: $("theme"), bars: $("bars"), barsVal: $("barsVal"), feed: $("feed"),
  tz: $("tz"), hr24: $("hr24"),
  key: $("key"), secret: $("secret"), toggleSecret: $("toggleSecret"),
  widget: $("widgetSlot"), img: $("previewImg"), placeholder: $("placeholder"),
  url: $("url"), copy: $("copy"), copied: $("copied"), refresh: $("refresh"),
};

const STORE_KEY = "stock-widget-settings";
const ASPECT = { small: "1 / 1", medium: "1092 / 507", large: "1092 / 1146" };

// ---- credential encryption (RSA-OAEP with the server's public key) ----
let PUBKEY = null; // imported CryptoKey, or null when no public key is configured
let encBlob = "";  // cached ciphertext of the current key + secret

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function importPublicKey(spkiB64) {
  return crypto.subtle.importKey("spki", b64ToBytes(spkiB64), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
}
async function encryptCreds(keyId, secret) {
  const data = new TextEncoder().encode(JSON.stringify({ k: keyId, s: secret }));
  const ct = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, PUBKEY, data);
  return bytesToB64url(new Uint8Array(ct));
}

let encTimer = null;
function scheduleEnc() {
  clearTimeout(encTimer);
  encTimer = setTimeout(recomputeEnc, 250);
}
async function recomputeEnc() {
  const keyId = els.key.value.trim();
  const secret = els.secret.value.trim();
  if (PUBKEY && keyId && secret) {
    try { encBlob = await encryptCreds(keyId, secret); } catch (_) { encBlob = ""; }
  } else {
    encBlob = "";
  }
  update();
}

// ---- persistence ----
function save() {
  const data = {};
  for (const k of ["ticker", "interval", "size", "theme", "bars", "feed", "tz", "key", "secret"]) {
    data[k] = els[k].value;
  }
  data.hr24 = els.hr24.checked;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) {}
}

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (_) {}
  if (saved.ticker) els.ticker.value = saved.ticker;
  for (const k of ["interval", "size", "theme", "bars", "feed", "tz", "key", "secret"]) {
    if (saved[k] != null && saved[k] !== "") els[k].value = saved[k];
  }
  els.hr24.checked = !!saved.hr24;
}

// Resolve the timezone to send: "auto" -> the device's IANA zone.
function resolvedTz() {
  if (els.tz.value && els.tz.value !== "auto") return els.tz.value;
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (_) { return "UTC"; }
}

// ---- URL building ----
function baseUrl() {
  return (window.WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
}

function buildUrl(cacheBust) {
  const p = new URLSearchParams();
  p.set("ticker", els.ticker.value.trim().toUpperCase());
  p.set("interval", els.interval.value);
  p.set("size", els.size.value);
  p.set("bars", els.bars.value);
  p.set("feed", els.feed.value);
  p.set("theme", els.theme.value);
  p.set("tz", resolvedTz());
  if (els.hr24.checked) p.set("hr24", "1");
  if (PUBKEY) {
    // Encrypted creds — the raw secret never enters the URL.
    if (encBlob) p.set("enc", encBlob);
  } else {
    // No public key configured: fall back to raw creds.
    if (els.key.value.trim()) p.set("key", els.key.value.trim());
    if (els.secret.value.trim()) p.set("secret", els.secret.value.trim());
  }
  if (cacheBust) p.set("_", String(Date.now()));
  return `${baseUrl()}/chart.png?${p.toString()}`;
}

function ready() {
  const b = baseUrl();
  const hasCreds = PUBKEY ? !!encBlob : els.key.value.trim() && els.secret.value.trim();
  return b && !b.includes("YOUR-SUBDOMAIN") && els.ticker.value.trim() && !!hasCreds;
}

// ---- rendering ----
let previewTimer = null;
function refreshPreview(cacheBust) {
  const size = els.size.value || "medium";
  els.widget.className = "widget " + size;
  els.placeholder.style.aspectRatio = ASPECT[size] || ASPECT.medium;
  if (!ready()) {
    els.img.classList.remove("show");
    els.placeholder.classList.remove("hide");
    return;
  }
  els.placeholder.classList.add("hide");
  els.img.src = buildUrl(cacheBust);
  els.img.classList.add("show");
}

function update(opts) {
  els.barsVal.textContent = els.bars.value;
  els.url.value = ready() ? buildUrl(false) : "Enter a ticker and your API keys to generate the URL.";
  save();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => refreshPreview(opts && opts.cacheBust), 400);
}

// ---- wire up ----
for (const k of ["ticker", "interval", "size", "theme", "bars", "feed", "tz", "hr24"]) {
  els[k].addEventListener("input", () => update());
  els[k].addEventListener("change", () => update());
}
// key/secret changes re-encrypt (which then calls update)
for (const k of ["key", "secret"]) {
  els[k].addEventListener("input", scheduleEnc);
  els[k].addEventListener("change", scheduleEnc);
}

els.toggleSecret.addEventListener("click", () => {
  els.secret.type = els.secret.type === "password" ? "text" : "password";
});

els.refresh.addEventListener("click", () => refreshPreview(true));

els.copy.addEventListener("click", async () => {
  if (!ready()) return;
  const text = buildUrl(false);
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    els.url.focus();
    els.url.select();
    document.execCommand("copy");
  }
  els.copied.hidden = false;
  setTimeout(() => (els.copied.hidden = true), 1600);
});

els.img.addEventListener("error", () => {
  els.placeholder.textContent = "Couldn't load preview — check the Worker URL and API keys.";
  els.placeholder.classList.remove("hide");
  els.img.classList.remove("show");
});
els.img.addEventListener("load", () => els.placeholder.classList.add("hide"));

load();
update();
(async () => {
  try {
    if (window.PUBLIC_KEY) PUBKEY = await importPublicKey(window.PUBLIC_KEY);
  } catch (_) {
    PUBKEY = null;
  }
  await recomputeEnc(); // encrypts saved creds (if any) and refreshes the preview
})();

// ---- Scriptable section: show the absolute script URL + copy button ----
(function () {
  const el = document.getElementById("scriptUrl");
  if (!el) return;
  const url = new URL("stock-widget.js", location.href).href;
  el.textContent = url;
  const btn = document.getElementById("copyScriptUrl");
  if (btn) {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = "Copied ✓";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      } catch (_) {}
    });
  }

  // Copy the whole script. iOS Safari only allows a clipboard write that STARTS
  // synchronously in the tap, so we can't await fetch() before writeText(). Use
  // ClipboardItem with a promise (Safari resolves it within the gesture); fall back
  // to fetch-then-writeText on browsers without ClipboardItem.
  const scriptBtn = document.getElementById("copyScript");
  if (scriptBtn) {
    const orig = scriptBtn.textContent;
    scriptBtn.addEventListener("click", () => {
      const finish = (ok) => {
        scriptBtn.textContent = ok ? "Copied ✓" : "Copy failed";
        setTimeout(() => (scriptBtn.textContent = orig), 1800);
      };
      const textPromise = fetch("stock-widget.js", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      });
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        const blob = textPromise.then((t) => new Blob([t], { type: "text/plain" }));
        navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).then(
          () => finish(true),
          () => finish(false),
        );
      } else {
        textPromise.then((t) => navigator.clipboard.writeText(t)).then(
          () => finish(true),
          () => finish(false),
        );
      }
    });
  }
})();
