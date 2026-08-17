"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  base: $("base"), baseHint: $("baseHint"),
  ticker: $("ticker"), interval: $("interval"), size: $("size"),
  theme: $("theme"), bars: $("bars"), barsVal: $("barsVal"), feed: $("feed"),
  tz: $("tz"), hr24: $("hr24"),
  key: $("key"), secret: $("secret"), toggleSecret: $("toggleSecret"),
  widget: $("widgetSlot"), img: $("previewImg"), placeholder: $("placeholder"),
  url: $("url"), copy: $("copy"), copied: $("copied"), refresh: $("refresh"),
};

const STORE_KEY = "stock-widget-settings";
const ASPECT = { small: "1 / 1", medium: "1092 / 507", large: "1092 / 1146" };

// ---- persistence ----
function save() {
  const data = {};
  for (const k of ["base", "ticker", "interval", "size", "theme", "bars", "feed", "tz", "key", "secret"]) {
    data[k] = els[k].value;
  }
  data.hr24 = els.hr24.checked;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) {}
}

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (_) {}
  els.base.value = saved.base || window.WORKER_BASE_URL || "";
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
  return (els.base.value || "").trim().replace(/\/+$/, "");
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
  if (els.key.value.trim()) p.set("key", els.key.value.trim());
  if (els.secret.value.trim()) p.set("secret", els.secret.value.trim());
  if (cacheBust) p.set("_", String(Date.now()));
  return `${baseUrl()}/chart.png?${p.toString()}`;
}

function ready() {
  const b = baseUrl();
  return (
    b && !b.includes("YOUR-SUBDOMAIN") &&
    els.ticker.value.trim() && els.key.value.trim() && els.secret.value.trim()
  );
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
  els.url.value = ready() ? buildUrl(false) : "Set Worker URL, ticker and API keys to generate the URL.";
  const b = baseUrl();
  els.baseHint.textContent = !b || b.includes("YOUR-SUBDOMAIN")
    ? "Set this to your deployed Worker URL (…workers.dev)."
    : "";
  save();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => refreshPreview(opts && opts.cacheBust), 400);
}

// ---- wire up ----
for (const k of ["base", "ticker", "interval", "size", "theme", "bars", "feed", "tz", "hr24", "key", "secret"]) {
  els[k].addEventListener("input", () => update());
  els[k].addEventListener("change", () => update());
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
refreshPreview(false);
