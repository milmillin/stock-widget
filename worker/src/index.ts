import { Hono } from "hono";
import { resolveSize } from "./sizes";
import { fetchBars, normalizeTimeframe, AlpacaError, VALID_FEEDS } from "./alpaca";
import { buildChartSvg, buildMessageSvg } from "./chart";
import { svgToPng } from "./render";

interface Env {
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
      "  bars     30          number of candles (5-200)\n" +
      "  feed     iex         iex | sip\n" +
      "  theme    dark        dark | light\n" +
      "  key      required*   Alpaca API Key ID    (*or set ALPACA_KEY_ID secret)\n" +
      "  secret   required*   Alpaca API Secret    (*or set ALPACA_SECRET secret)\n" +
      "  format   png         png | json (json returns raw bars for debugging)\n",
  ),
);

app.get("/chart.png", async (c) => {
  const q = c.req.query();
  const { size, dims } = resolveSize(q.size);
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
  const bars = clamp(parseInt(q.bars ?? "30", 10) || 30, 5, 200);

  const keyId = q.key ?? c.env.ALPACA_KEY_ID ?? "";
  const secretKey = q.secret ?? c.env.ALPACA_SECRET ?? "";
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
      feed,
      size,
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
