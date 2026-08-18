"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  ticker: $("ticker"), interval: $("interval"), device: $("device"), size: $("size"),
  theme: $("theme"), bars: $("bars"), barsVal: $("barsVal"), feed: $("feed"),
  tz: $("tz"), hr24: $("hr24"), hl: $("hl"),
  key: $("key"), secret: $("secret"), toggleSecret: $("toggleSecret"),
  img: $("previewImg"), placeholder: $("placeholder"), dims: $("dims"),
  indList: $("indList"), addInd: $("addInd"),
  url: $("url"), copy: $("copy"), copied: $("copied"), refresh: $("refresh"),
};

// ---- indicators ----
const IND_TYPES = {
  sma: { label: "SMA", params: ["Period"], defaults: [20] },
  ema: { label: "EMA", params: ["Period"], defaults: [20] },
  wma: { label: "WMA", params: ["Period"], defaults: [20] },
  bb: { label: "Bollinger", params: ["Period", "Mult"], defaults: [20, 2] },
  vwap: { label: "VWAP", params: [], defaults: [] },
  rsi: { label: "RSI", params: ["Period"], defaults: [14] },
  macd: { label: "MACD", params: ["Fast", "Slow", "Signal"], defaults: [12, 26, 9] },
  stoch: { label: "Stochastic", params: ["Period", "%K", "%D"], defaults: [14, 3, 3] },
  vol: { label: "Volume", params: [], defaults: [] },
};
const IND_ORDER = ["sma", "ema", "wma", "bb", "vwap", "rsi", "macd", "stoch", "vol"];
let indicators = []; // [{ type, params:[…] }]

function renderIndList() {
  const box = els.indList;
  if (!box) return;
  box.textContent = "";
  indicators.forEach((ind, idx) => {
    const row = document.createElement("div");
    row.className = "ind-row";

    const sel = document.createElement("select");
    sel.className = "ind-type";
    for (const t of IND_ORDER) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = IND_TYPES[t].label;
      if (t === ind.type) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      ind.type = sel.value;
      ind.params = IND_TYPES[sel.value].defaults.slice();
      renderIndList();
      update();
    });
    row.appendChild(sel);

    IND_TYPES[ind.type].params.forEach((plabel, pi) => {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.className = "ind-param";
      inp.min = "1";
      inp.title = plabel;
      inp.placeholder = plabel;
      inp.value = ind.params[pi] != null ? String(ind.params[pi]) : "";
      inp.addEventListener("input", () => {
        ind.params[pi] = parseFloat(inp.value) || IND_TYPES[ind.type].defaults[pi];
        update();
      });
      row.appendChild(inp);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost ind-del";
    del.textContent = "×";
    del.title = "Remove";
    del.addEventListener("click", () => {
      indicators.splice(idx, 1);
      renderIndList();
      update();
    });
    row.appendChild(del);
    box.appendChild(row);
  });
}

const STORE_KEY = "stock-widget-settings";

// Widget sizes in POINTS [w,h] keyed by device screen size (points, portrait "WxH").
// Multiplied by the device scale to get exact pixels so the image renders 1:1.
const WIDGET_POINTS = {
  "440x956": { small: [170, 170], medium: [364, 170], large: [364, 382] },
  "402x874": { small: [162, 162], medium: [344, 162], large: [344, 366] },
  "430x932": { small: [170, 170], medium: [364, 170], large: [364, 382] },
  "393x852": { small: [158, 158], medium: [338, 158], large: [338, 354] },
  "428x926": { small: [170, 170], medium: [364, 170], large: [364, 382] },
  "390x844": { small: [158, 158], medium: [338, 158], large: [338, 354] },
  "375x812": { small: [155, 155], medium: [329, 155], large: [329, 345] },
  "414x896": { small: [169, 169], medium: [360, 169], large: [360, 379] },
  "414x736": { small: [159, 159], medium: [348, 157], large: [348, 357] },
  "375x667": { small: [148, 148], medium: [321, 148], large: [321, 324] },
  "320x568": { small: [141, 141], medium: [292, 141], large: [292, 311] },
  "1024x1366": { small: [170, 170], medium: [378.5, 170], large: [378.5, 378.5] },
  "834x1194": { small: [155, 155], medium: [342, 155], large: [342, 342] },
  "820x1180": { small: [155, 155], medium: [342, 155], large: [342, 342] },
  "810x1080": { small: [146, 146], medium: [320.5, 146], large: [320.5, 320.5] },
  "768x1024": { small: [141, 141], medium: [305.5, 141], large: [305.5, 305.5] },
};

// Device dropdown options: { label, key (screen WxH points), scale }.
const DEVICES = [
  { label: "iPhone 16 Pro Max", key: "440x956", scale: 3 },
  { label: "iPhone 16 Pro", key: "402x874", scale: 3 },
  { label: "iPhone 16 Plus · 15 Plus · 15/14 Pro Max", key: "430x932", scale: 3 },
  { label: "iPhone 16 · 15 · 15/14 Pro", key: "393x852", scale: 3 },
  { label: "iPhone 14 Plus · 13/12 Pro Max", key: "428x926", scale: 3 },
  { label: "iPhone 14 · 13 · 12 (& Pro)", key: "390x844", scale: 3 },
  { label: "iPhone 13/12 mini · 11 Pro · XS · X", key: "375x812", scale: 3 },
  { label: "iPhone 11 Pro Max · XS Max", key: "414x896", scale: 3 },
  { label: "iPhone 11 · XR", key: "414x896", scale: 2 },
  { label: "iPhone 8/7/6s Plus", key: "414x736", scale: 3 },
  { label: "iPhone SE (2/3) · 8 · 7", key: "375x667", scale: 2 },
  { label: "iPhone SE (1st gen)", key: "320x568", scale: 2 },
  { label: 'iPad Pro 12.9" / 13"', key: "1024x1366", scale: 2 },
  { label: 'iPad Pro 11" · Air 11"', key: "834x1194", scale: 2 },
  { label: 'iPad Air 10.9" · iPad 10th', key: "820x1180", scale: 2 },
  { label: 'iPad 10.2"', key: "810x1080", scale: 2 },
  { label: 'iPad 9.7" · mini', key: "768x1024", scale: 2 },
];
const DEFAULT_DEVICE = "393x852@3";
const CORNER_PT = 22; // iOS widget corner radius (approx), ~constant across sizes

const deviceVal = (d) => `${d.key}@${d.scale}`;
function populateDevices() {
  els.device.innerHTML = DEVICES.map((d) => `<option value="${deviceVal(d)}">${d.label}</option>`).join("");
}
function currentDevice() {
  return DEVICES.find((d) => deviceVal(d) === els.device.value) || DEVICES.find((d) => d.key === "393x852") || DEVICES[0];
}
function sizePoints() {
  const d = currentDevice();
  return (WIDGET_POINTS[d.key] || WIDGET_POINTS["393x852"])[els.size.value] || WIDGET_POINTS["393x852"].medium;
}
function widgetPixels() {
  const d = currentDevice();
  const pts = sizePoints();
  return { w: Math.round(pts[0] * d.scale), h: Math.round(pts[1] * d.scale) };
}
// Match the browser's screen size (points) + devicePixelRatio to a device.
function detectDeviceValue() {
  try {
    const w = Math.min(screen.width, screen.height);
    const h = Math.max(screen.width, screen.height);
    const key = `${w}x${h}`;
    const dpr = Math.round(window.devicePixelRatio || 1);
    const d = DEVICES.find((x) => x.key === key && x.scale === dpr) || DEVICES.find((x) => x.key === key);
    return d ? deviceVal(d) : null;
  } catch (_) {
    return null;
  }
}

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
  for (const k of ["ticker", "interval", "device", "size", "theme", "bars", "feed", "tz", "key", "secret"]) {
    data[k] = els[k].value;
  }
  data.hr24 = els.hr24.checked;
  data.hl = els.hl.checked;
  data.indicators = indicators;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) {}
}

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (_) {}
  if (saved.ticker) els.ticker.value = saved.ticker;
  for (const k of ["interval", "device", "size", "theme", "bars", "feed", "tz", "key", "secret"]) {
    if (saved[k] != null && saved[k] !== "") els[k].value = saved[k];
  }
  els.hr24.checked = !!saved.hr24;
  els.hl.checked = !!saved.hl;
  indicators = Array.isArray(saved.indicators)
    ? saved.indicators.filter((i) => i && IND_TYPES[i.type]).map((i) => ({ type: i.type, params: Array.isArray(i.params) ? i.params.slice() : IND_TYPES[i.type].defaults.slice() }))
    : [];
  // Auto-detect the device when none was saved (works when browsing on the phone).
  if (!saved.device) els.device.value = detectDeviceValue() || DEFAULT_DEVICE;
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
  const px = widgetPixels(); // exact device pixels -> crisp 1:1
  p.set("w", px.w);
  p.set("h", px.h);
  if (els.hl.checked) {
    p.set("hl", "1");
    p.set("hlr", String(Math.round(CORNER_PT * currentDevice().scale))); // rim radius in px
  }
  const indStr = indicators
    .filter((i) => IND_TYPES[i.type])
    .map((i) => [i.type, ...i.params].join(":"))
    .join(",");
  if (indStr) p.set("ind", indStr);
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
  const px = widgetPixels();
  const pts = sizePoints();
  // Circular corners that scale with the displayed size: horizontal % = CORNER/widthPt,
  // vertical % = that × aspect (so both radii resolve to the same length).
  const frac = CORNER_PT / pts[0];
  const radius = `${(frac * 100).toFixed(2)}% / ${(frac * (px.w / px.h) * 100).toFixed(2)}%`;
  // Display at POINT size (pre-@scale) — the widget's true on-phone size. The image is
  // the full-res pixel PNG, so it stays crisp on Retina. Capped to the column on mobile.
  els.img.style.width = pts[0] + "px";
  els.img.style.borderRadius = radius;
  els.placeholder.style.width = pts[0] + "px";
  els.placeholder.style.aspectRatio = `${pts[0]} / ${pts[1]}`;
  els.placeholder.style.borderRadius = radius;
  if (els.dims) els.dims.textContent = `· ${px.w}×${px.h}`;

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
for (const k of ["ticker", "interval", "device", "size", "theme", "bars", "feed", "tz", "hr24", "hl"]) {
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

els.addInd.addEventListener("click", () => {
  indicators.push({ type: "sma", params: IND_TYPES.sma.defaults.slice() });
  renderIndList();
  update();
});

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

populateDevices();
load();
renderIndList();
update();
(async () => {
  try {
    if (window.PUBLIC_KEY) PUBKEY = await importPublicKey(window.PUBLIC_KEY);
  } catch (_) {
    PUBKEY = null;
  }
  await recomputeEnc(); // encrypts saved creds (if any) and refreshes the preview
})();
