import { Hono } from "hono";
import { resolveSize } from "./sizes";
import { fetchBars, normalizeTimeframe, AlpacaError, VALID_FEEDS } from "./alpaca";
import { buildChartSvg, buildMessageSvg } from "./chart";
import { svgToPng } from "./render";
import { decryptCreds } from "./crypto";

interface Env {
  // RSA-OAEP private key (PKCS8 base64) that decrypts the `enc` credential blob.
  // Set locally in .dev.vars and in prod via `wrangler secret put PRIVATE_KEY`.
  PRIVATE_KEY?: string;
  // Optional server-side fallback creds. If set, callers can omit key/secret
  // from the URL (`wrangler secret put ALPACA_KEY_ID` / `ALPACA_SECRET`).
  ALPACA_KEY_ID?: string;
  ALPACA_SECRET?: string;
}

const app = new Hono<{ Bindings: Env }>();

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

app.get("/", (c) =>
  c.text(
    "stock-widget — candlestick chart PNG endpoint\n\n" +
      "GET /chart.png\n" +
      "  ticker   required   e.g. AAPL\n" +
      "  interval 1Day       Alpaca timeframe (1Min..59Min,1Hour..23Hour,1Day,1Week,1Month..12Month)\n" +
      "  size     medium     small | medium | large\n" +
      "  w, h     (size)     exact pixel dimensions; overrides size preset, keeps its style\n" +
      "  bars     90          number of candles (5-200)\n" +
      "  feed     iex         iex | sip\n" +
      "  theme    dark        dark | light\n" +
      "  tz       UTC         IANA timezone for the 'last queried' time, e.g. America/New_York\n" +
      "  hr24     0           1 = 24-hour clock (also accepts 24hr param)\n" +
      "  enc      required*   RSA-OAEP encrypted {k,s} creds (preferred; from the site)\n" +
      "  key      required*   Alpaca API Key ID    (raw alternative to enc)\n" +
      "  secret   required*   Alpaca API Secret    (raw alternative to enc)\n" +
      "             (*provide enc, OR key+secret, OR set ALPACA_KEY_ID/ALPACA_SECRET secrets)\n" +
      "  format   png         png | json (json returns raw bars for debugging)\n",
  ),
);

app.get("/chart.png", async (c) => {
  const q = c.req.query();
  const { size, dims: presetDims } = resolveSize(q.size);
  // Optional exact pixel dimensions (e.g. a device's real widget size) — keeps `size`
  // for styling but renders 1:1 so the image isn't rescaled/blurred by the client.
  const wq = clamp(parseInt(q.w ?? "", 10) || 0, 0, 2000);
  const hq = clamp(parseInt(q.h ?? "", 10) || 0, 0, 2000);
  const dims = wq >= 120 && hq >= 120 ? { width: wq, height: hq } : presetDims;
  const theme = q.theme === "light" ? "light" : "dark";
  const ticker = (q.ticker ?? "").trim().toUpperCase();
  const wantJson = q.format === "json";

  const sendPng = async (svg: string) => {
    const png = await svgToPng(svg);
    return new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  };

  const errorImage = (msg: string) =>
    sendPng(buildMessageSvg(msg, { width: dims.width, height: dims.height, theme, ticker }));

  // ---- validate params ----
  if (!ticker || !/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return wantJson ? c.json({ error: "Missing or invalid ticker" }, 400) : errorImage("Enter a ticker");
  }
  const timeframe = normalizeTimeframe(q.interval);
  if (!timeframe) {
    return wantJson ? c.json({ error: "Invalid interval" }, 400) : errorImage("Invalid interval");
  }
  const feed = (VALID_FEEDS as readonly string[]).includes(q.feed ?? "") ? (q.feed as string) : "iex";
  const bars = clamp(parseInt(q.bars ?? "90", 10) || 90, 5, 200);
  const tz = q.tz || undefined;
  const hr24 = ["1", "true", "yes", "24"].includes((q.hr24 ?? q["24hr"] ?? "").toLowerCase());

  let keyId = q.key ?? c.env.ALPACA_KEY_ID ?? "";
  let secretKey = q.secret ?? c.env.ALPACA_SECRET ?? "";
  // Encrypted credentials (?enc=...) take precedence — decrypt with the private key.
  if (q.enc) {
    if (!c.env.PRIVATE_KEY) {
      return wantJson ? c.json({ error: "Server missing PRIVATE_KEY" }, 500) : errorImage("Server key missing");
    }
    try {
      const creds = await decryptCreds(q.enc, c.env.PRIVATE_KEY);
      keyId = creds.key;
      secretKey = creds.secret;
    } catch {
      return wantJson ? c.json({ error: "Could not decrypt credentials" }, 400) : errorImage("Bad encrypted key");
    }
  }
  if (!keyId || !secretKey) {
    return wantJson ? c.json({ error: "Missing Alpaca key/secret" }, 400) : errorImage("Missing API key");
  }

  // ---- fetch + render ----
  try {
    const data = await fetchBars({ ticker, timeframe, limit: bars, feed, keyId, secretKey });
    if (wantJson) {
      return c.json(
        { ticker, timeframe, feed, size, count: data.length, bars: data },
        200,
        { "Access-Control-Allow-Origin": "*" },
      );
    }
    if (data.length === 0) return errorImage("No data");
    const svg = buildChartSvg(data, {
      width: dims.width,
      height: dims.height,
      theme,
      ticker,
      interval: timeframe,
      size,
      tz,
      hr24,
      now: new Date(),
    });
    return sendPng(svg);
  } catch (err) {
    if (wantJson) {
      const msg = err instanceof AlpacaError ? err.message : "Render error";
      const status = err instanceof AlpacaError ? err.status : 500;
      return c.json({ error: msg }, status as 400);
    }
    let short = "Render error";
    if (err instanceof AlpacaError) {
      short =
        err.status === 401 || err.status === 403
          ? "Invalid API key"
          : err.status === 429
            ? "Rate limited"
            : "Data error";
    }
    return errorImage(short);
  }
});

export default app;
