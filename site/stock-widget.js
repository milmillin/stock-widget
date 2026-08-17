// 📈 Stock Widget — a Scriptable widget that shows a candlestick chart from your
// stock-widget Cloudflare Worker.
//
// Run this script inside the Scriptable app to configure it (Worker URL + Alpaca
// keys + defaults) and preview. Then add a Scriptable widget to your Home Screen and
// set its "Parameter" to a ticker (e.g. TSLA) to show a different symbol per widget.
//
// Credentials are stored in the iOS Keychain and sent directly to your Worker over
// HTTPS — they are never placed in a shared/pasted URL.

const SETTINGS_KEY = "stockwidget.settings";
const KEY_ID = "stockwidget.key";
const KEY_SECRET = "stockwidget.secret";

const INTERVALS = ["1Min", "5Min", "15Min", "30Min", "1Hour", "1Day", "1Week", "1Month"];
const SIZES = ["small", "medium", "large"];
const THEMES = ["dark", "light"];
const FEEDS = ["iex", "sip"];

// Widget dimensions in POINTS per device screen size (portrait "WxH"), from Apple's HIG
// cross-checked with the mzeryck Scriptable size table. Multiplied by Device.screenScale()
// to get exact pixels so the chart renders 1:1 (no rescale/blur). [width, height].
// iPhone values are confirmed except the two 16 Pro variants (⚠, single-source but consistent).
const WIDGET_POINTS = {
  // iPhones (scale 3, except 11/XR and SE which are scale 2 — handled by screenScale())
  "440x956": { small: [170, 170], medium: [364, 170], large: [364, 382] }, // 16 Pro Max
  "402x874": { small: [162, 162], medium: [344, 162], large: [344, 366] }, // 16 Pro ⚠
  "430x932": { small: [170, 170], medium: [364, 170], large: [364, 382] }, // 16 Plus, 15 Plus/Pro Max, 14 Pro Max
  "393x852": { small: [158, 158], medium: [338, 158], large: [338, 354] }, // 16, 15/15 Pro, 14 Pro
  "428x926": { small: [170, 170], medium: [364, 170], large: [364, 382] }, // 14 Plus, 13/12 Pro Max
  "390x844": { small: [158, 158], medium: [338, 158], large: [338, 354] }, // 14, 13/13 Pro, 12/12 Pro
  "375x812": { small: [155, 155], medium: [329, 155], large: [329, 345] }, // 13/12 mini, 11 Pro, XS, X
  "414x896": { small: [169, 169], medium: [360, 169], large: [360, 379] }, // 11 Pro Max, XS Max, 11, XR
  "414x736": { small: [159, 159], medium: [348, 157], large: [348, 357] }, // 8/7/6s Plus
  "375x667": { small: [148, 148], medium: [321, 148], large: [321, 324] }, // SE 2/3, 8, 7, 6s
  "320x568": { small: [141, 141], medium: [292, 141], large: [292, 311] }, // SE 1, 5s

  // iPads (scale 2) — "Canvas" render sizes; also support extraLarge
  "768x1024": { small: [141, 141], medium: [305.5, 141], large: [305.5, 305.5], extraLarge: [634.5, 305.5] }, // iPad 9.7"/10.2", mini
  "810x1080": { small: [146, 146], medium: [320.5, 146], large: [320.5, 320.5], extraLarge: [669, 320.5] }, // iPad 10.2" (7–9th)
  "820x1180": { small: [155, 155], medium: [342, 155], large: [342, 342], extraLarge: [715.5, 342] }, // iPad Air 10.9", iPad 10th
  "834x1112": { small: [150, 150], medium: [327.5, 150], large: [327.5, 327.5], extraLarge: [682, 327.5] }, // iPad Pro/Air 10.5"
  "834x1194": { small: [155, 155], medium: [342, 155], large: [342, 342], extraLarge: [715.5, 342] }, // iPad Pro 11", Air 11" M2
  "954x1373": { small: [162, 162], medium: [350, 162], large: [350, 350], extraLarge: [726, 350] }, // iPad Pro 11" (More Space)
  "970x1389": { small: [162, 162], medium: [350, 162], large: [350, 350], extraLarge: [726, 350] }, // iPad Pro 11" M4 (More Space)
  "1024x1366": { small: [170, 170], medium: [378.5, 170], large: [378.5, 378.5], extraLarge: [795, 378.5] }, // iPad Pro 12.9"
  "1032x1376": { small: [170, 170], medium: [378.5, 170], large: [378.5, 378.5], extraLarge: [795, 378.5] }, // iPad Pro 13" M4
  "1192x1590": { small: [188, 188], medium: [412, 188], large: [412, 412], extraLarge: [860, 412] }, // iPad Pro 12.9"/13" (More Space)
};

// Rough fallback so a device not in the table still renders sensibly.
function estimateWidgetPoints(w, h, family) {
  const small = Math.round(w * 0.404);
  const mediumW = Math.round(w * 0.862);
  if (family === "small") return [small, small];
  if (family === "medium") return [mediumW, small];
  if (family === "large") return [mediumW, Math.round(h * 0.42)];
  return null; // extraLarge / accessory -> preset fallback
}

// Exact widget pixel size for this device+family, or null to fall back to the preset.
function widgetPixelSize(family) {
  try {
    const sz = Device.screenSize();
    const scale = Device.screenScale();
    const w = Math.round(Math.min(sz.width, sz.height));
    const h = Math.round(Math.max(sz.width, sz.height));
    const e = WIDGET_POINTS[`${w}x${h}`];
    const pts = (e && e[family]) || estimateWidgetPoints(w, h, family);
    if (pts) return { w: Math.round(pts[0] * scale), h: Math.round(pts[1] * scale) };
  } catch (_) {
    /* Device API unavailable */
  }
  return null;
}

// ---------- storage ----------
function deviceTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch (_) {
    return "UTC";
  }
}

function loadSettings() {
  const def = {
    baseUrl: "",
    ticker: "AAPL",
    interval: "1Day",
    size: "medium",
    bars: 90,
    feed: "iex",
    theme: "dark",
    tz: deviceTz(),
    hr24: false,
  };
  if (!Keychain.contains(SETTINGS_KEY)) return def;
  try {
    return Object.assign(def, JSON.parse(Keychain.get(SETTINGS_KEY)));
  } catch (_) {
    return def;
  }
}

function saveSettings(s) {
  Keychain.set(SETTINGS_KEY, JSON.stringify(s));
}

function getCred(k) {
  return Keychain.contains(k) ? Keychain.get(k) : "";
}
function setCred(k, v) {
  if (v) Keychain.set(k, v);
  else if (Keychain.contains(k)) Keychain.remove(k);
}

// ---------- url ----------
function buildUrl(s, key, secret, ticker, size, px) {
  const p = [];
  const add = (k, v) => p.push(`${k}=${encodeURIComponent(v)}`);
  add("ticker", String(ticker || s.ticker || "AAPL").toUpperCase());
  add("interval", s.interval || "1Day");
  add("size", size || s.size || "medium");
  add("bars", String(s.bars || 90));
  add("feed", s.feed || "iex");
  add("theme", s.theme || "dark");
  if (s.tz) add("tz", s.tz);
  if (s.hr24) add("hr24", "1");
  if (px && px.w && px.h) {
    add("w", px.w); // exact device pixels -> rendered 1:1, crisp
    add("h", px.h);
  }
  if (key) add("key", key);
  if (secret) add("secret", secret);
  add("_", String(Date.now())); // cache-buster so each widget refresh is fresh
  const base = (s.baseUrl || "").replace(/\/+$/, "");
  return `${base}/chart.png?${p.join("&")}`;
}

// Merge the per-widget Parameter over the saved settings.
// Accepts a plain ticker ("TSLA"), a CSV ("TSLA,15Min,60"), or JSON ({"ticker":"TSLA"}).
function applyParam(s) {
  const raw = typeof args !== "undefined" && args.widgetParameter ? String(args.widgetParameter).trim() : "";
  if (!raw) return Object.assign({}, s);
  if (raw.startsWith("{")) {
    try {
      return Object.assign({}, s, JSON.parse(raw));
    } catch (_) {
      /* fall through */
    }
  }
  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const o = Object.assign({}, s);
  if (parts[0]) o.ticker = parts[0].toUpperCase();
  if (parts[1]) o.interval = parts[1];
  if (parts[2]) o.bars = parseInt(parts[2], 10) || o.bars;
  return o;
}

// ---------- widget ----------
function textWidget(title, msg, theme) {
  const w = new ListWidget();
  w.backgroundColor = new Color(theme === "light" ? "#ffffff" : "#0d1117");
  const t = w.addText(title);
  t.font = Font.boldSystemFont(20);
  t.textColor = theme === "light" ? new Color("#0d1117") : Color.white();
  w.addSpacer(6);
  const m = w.addText(msg);
  m.font = Font.systemFont(12);
  m.textColor = new Color("#8b949e");
  w.url = openScriptURL();
  return w;
}

function openScriptURL() {
  return `scriptable:///run/${encodeURIComponent(Script.name())}`;
}

async function buildWidget() {
  const s = applyParam(loadSettings());
  const key = getCred(KEY_ID);
  const secret = getCred(KEY_SECRET);
  const size = config.widgetFamily || s.size || "medium";

  if (!s.baseUrl || !key || !secret) {
    return textWidget("📈 Stock Widget", "Open the app to set the Worker URL and your Alpaca keys.", s.theme);
  }

  const url = buildUrl(s, key, secret, s.ticker, size, widgetPixelSize(size));
  try {
    const req = new Request(url);
    req.timeoutInterval = 20;
    const img = await req.loadImage();
    const w = new ListWidget();
    w.backgroundColor = new Color(s.theme === "light" ? "#ffffff" : "#0d1117");
    w.backgroundImage = img;
    w.url = openScriptURL();
    w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000); // hint; iOS decides
    return w;
  } catch (e) {
    return textWidget(String(s.ticker || "Error"), "Couldn't load chart.\n" + String(e).slice(0, 90), s.theme);
  }
}

// ---------- in-app config UI ----------
function mask(v) {
  if (!v) return "— tap to set";
  return v.length <= 6 ? "••••" : v.slice(0, 3) + "…" + v.slice(-2);
}

async function promptText(title, message, current, secure) {
  const a = new Alert();
  a.title = title;
  if (message) a.message = message;
  if (secure) a.addSecureTextField("", current || "");
  else a.addTextField("", current || "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  const idx = await a.present();
  return idx === -1 ? null : a.textFieldValue(0);
}

async function promptChoice(title, options, current) {
  const a = new Alert();
  a.title = title;
  for (const o of options) a.addAction(o + (o === current ? "  ✓" : ""));
  a.addCancelAction("Cancel");
  const idx = await a.present();
  return idx === -1 ? null : options[idx];
}

async function notify(msg) {
  const a = new Alert();
  a.title = "Stock Widget";
  a.message = msg;
  a.addAction("OK");
  await a.present();
}

async function showConfigUI() {
  const table = new UITable();
  table.showSeparators = true;

  const header = (text) => {
    const r = new UITableRow();
    r.isHeader = true;
    r.addText(text).titleFont = Font.boldSystemFont(17);
    table.addRow(r);
  };
  const setting = (title, value, onSelect) => {
    const r = new UITableRow();
    r.height = 52;
    r.dismissOnSelect = false;
    const c = r.addText(title, value == null || value === "" ? "— tap to set" : String(value));
    c.titleFont = Font.systemFont(16);
    c.subtitleFont = Font.systemFont(12);
    c.subtitleColor = new Color("#8b949e");
    r.onSelect = onSelect;
    table.addRow(r);
  };
  const button = (title, onSelect) => {
    const r = new UITableRow();
    r.height = 48;
    r.dismissOnSelect = false;
    const c = r.addText(title);
    c.titleColor = new Color("#2f81f7");
    c.titleFont = Font.semiboldSystemFont(16);
    r.onSelect = onSelect;
    table.addRow(r);
  };
  const commit = async (s) => {
    saveSettings(s);
    await render();
    table.reload();
  };

  async function render() {
    const s = loadSettings();
    table.removeAllRows();

    header("Connection");
    setting("Worker URL", s.baseUrl, async () => {
      const v = await promptText("Worker URL", "https://stock-widget.<you>.workers.dev", s.baseUrl);
      if (v != null) {
        s.baseUrl = v.trim().replace(/\/+$/, "");
        await commit(s);
      }
    });
    setting("Alpaca Key ID", mask(getCred(KEY_ID)), async () => {
      const v = await promptText("Alpaca Key ID", "A paper key is recommended", getCred(KEY_ID));
      if (v != null) {
        setCred(KEY_ID, v.trim());
        await render();
        table.reload();
      }
    });
    setting("Alpaca Secret", mask(getCred(KEY_SECRET)), async () => {
      const v = await promptText("Alpaca Secret", "Stored in the iOS Keychain", getCred(KEY_SECRET), true);
      if (v != null) {
        setCred(KEY_SECRET, v.trim());
        await render();
        table.reload();
      }
    });

    header("Defaults");
    setting("Ticker", s.ticker, async () => {
      const v = await promptText("Default ticker", "e.g. AAPL", s.ticker);
      if (v) {
        s.ticker = v.trim().toUpperCase();
        await commit(s);
      }
    });
    setting("Interval", s.interval, async () => {
      const v = await promptChoice("Interval", INTERVALS, s.interval);
      if (v) {
        s.interval = v;
        await commit(s);
      }
    });
    setting("Size", s.size, async () => {
      const v = await promptChoice("Widget size", SIZES, s.size);
      if (v) {
        s.size = v;
        await commit(s);
      }
    });
    setting("Bars", s.bars, async () => {
      const v = await promptText("Bars (5–200)", "Number of candles", String(s.bars));
      if (v != null) {
        s.bars = Math.max(5, Math.min(200, parseInt(v, 10) || 90));
        await commit(s);
      }
    });
    setting("Theme", s.theme, async () => {
      const v = await promptChoice("Theme", THEMES, s.theme);
      if (v) {
        s.theme = v;
        await commit(s);
      }
    });
    setting("Feed", s.feed, async () => {
      const v = await promptChoice("Data feed", FEEDS, s.feed);
      if (v) {
        s.feed = v;
        await commit(s);
      }
    });
    setting("Timezone", s.tz, async () => {
      const v = await promptText("Timezone", "IANA, e.g. America/New_York", s.tz);
      if (v != null) {
        s.tz = v.trim();
        await commit(s);
      }
    });
    setting("24-hour clock", s.hr24 ? "On" : "Off", async () => {
      s.hr24 = !s.hr24;
      await commit(s);
    });

    header("Actions");
    button("👁  Preview (medium)", async () => {
      const w = await buildWidget();
      await w.presentMedium();
    });
    button("📋  Copy widget parameter", async () => {
      Pasteboard.copy(s.ticker);
      await notify(`Copied "${s.ticker}". Paste it into the widget's Parameter field on the Home Screen.`);
    });
    button("🔗  Copy full chart URL", async () => {
      Pasteboard.copy(buildUrl(s, getCred(KEY_ID), getCred(KEY_SECRET), s.ticker, s.size));
      await notify("Chart URL copied.");
    });
  }

  await render();
  await table.present();
}

// ---------- entry ----------
if (config.runsInWidget) {
  Script.setWidget(await buildWidget());
  Script.complete();
} else {
  await showConfigUI();
}
