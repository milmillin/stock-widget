import type { Bar } from "./alpaca";
import type { WidgetSize } from "./sizes";

export interface ChartOptions {
  width: number;
  height: number;
  theme: "dark" | "light";
  ticker: string;
  interval: string;
  size: WidgetSize;
  tz?: string; // IANA timezone for the "last queried" stamp (default UTC)
  hr24: boolean; // 24-hour clock for the stamp
  now?: Date; // when the data was queried (defaults to render time)
}

interface Palette {
  bgFrom: string;
  bgTo: string;
  text: string;
  subtext: string;
  up: string;
  down: string;
}

function palette(theme: "dark" | "light"): Palette {
  if (theme === "light") {
    return { bgFrom: "#ffffff", bgTo: "#eef1f5", text: "#0d1117", subtext: "#6b7280", up: "#12a969", down: "#e5484d" };
  }
  return { bgFrom: "#141b27", bgTo: "#0a0e14", text: "#e6edf3", subtext: "#8b949e", up: "#26a69a", down: "#ef5350" };
}

interface Style {
  padX: number;
  padTop: number;
  padBottom: number;
  fTitle: number;
  fPrice: number;
  fChange: number;
  fFoot: number;
  gapFrac: number;
  wick: number;
}

const STYLES: Record<WidgetSize, Style> = {
  small: { padX: 40, padTop: 132, padBottom: 40, fTitle: 42, fPrice: 44, fChange: 25, fFoot: 19, gapFrac: 0.3, wick: 1.6 },
  medium: { padX: 48, padTop: 156, padBottom: 48, fTitle: 42, fPrice: 44, fChange: 25, fFoot: 19, gapFrac: 0.32, wick: 2.2 },
  large: { padX: 56, padTop: 188, padBottom: 56, fTitle: 42, fPrice: 44, fChange: 25, fFoot: 19, gapFrac: 0.34, wick: 2.8 },
};

const UNIT_ABBR: Record<string, string> = { Min: "m", Hour: "H", Day: "D", Week: "W", Month: "M" };

const r = (n: number) => Math.round(n * 100) / 100;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function fmtPrice(n: number): string {
  const a = Math.abs(n);
  const d = a >= 1 ? 2 : 4;
  return n.toFixed(d);
}

/** "1Day" -> "1D", "15Min" -> "15m", "1Hour" -> "1H", "1Week" -> "1W". */
function abbrevInterval(tf: string): string {
  const m = /^(\d{1,2})(Min|Hour|Day|Week|Month)$/i.exec(tf);
  if (!m) return tf;
  const unit = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  return `${parseInt(m[1], 10)}${UNIT_ABBR[unit] ?? ""}`;
}

/** Format the query time as HH:MM in the requested timezone (no zone label). */
function fmtQueried(d: Date, tz: string | undefined, hr24: boolean): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: hr24 ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: !hr24,
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz || "UTC" }).format(d);
  } catch {
    // invalid timezone -> fall back to UTC
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(d);
  }
}

interface TextOpts {
  x: number;
  y: number;
  size: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  weight?: 400 | 700;
  opacity?: number;
}

function text(s: string, o: TextOpts): string {
  const anchor = o.anchor ?? "start";
  const weight = o.weight ?? 400;
  const op = o.opacity != null ? ` opacity="${o.opacity}"` : "";
  return (
    `<text x="${r(o.x)}" y="${r(o.y)}" font-family="Liberation Sans" ` +
    `font-size="${o.size}" font-weight="${weight}" fill="${o.fill}" ` +
    `text-anchor="${anchor}"${op}>${esc(s)}</text>`
  );
}

/**
 * Build a minimalist candlestick chart (no axes/gridlines/labels): a header with
 * ticker + price + daily change + interval, candles filling the body, and a small
 * "last queried" time stamp.
 */
// Reference width each size's STYLE is tuned for; used to scale the layout when the
// caller requests exact (device-specific) pixel dimensions via w/h.
const PRESET_WIDTH: Record<WidgetSize, number> = { small: 507, medium: 1092, large: 1092 };

export function buildChartSvg(bars: Bar[], o: ChartOptions): string {
  const { width: W, height: H, ticker, interval } = o;
  const p = palette(o.theme);
  const now = o.now ?? new Date();

  // Scale the (absolute-px) style to the actual canvas so the chart stays
  // proportional at any requested size. k = 1 for the preset dimensions.
  const styleBase = STYLES[o.size];
  const k = W / PRESET_WIDTH[o.size];
  const s = {
    padX: styleBase.padX * k,
    padTop: styleBase.padTop * k,
    padBottom: styleBase.padBottom * k,
    fTitle: styleBase.fTitle * k,
    fPrice: styleBase.fPrice * k,
    fChange: styleBase.fChange * k,
    fFoot: styleBase.fFoot * k,
    gapFrac: styleBase.gapFrac,
    wick: styleBase.wick * k,
  };

  const plotLeft = s.padX;
  const plotRight = W - s.padX;
  const plotTop = s.padTop;
  const plotBottom = H - s.padBottom;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  // ---- price domain (with headroom so wicks don't touch the edges) ----
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.l < lo) lo = b.l;
    if (b.h > hi) hi = b.h;
  }
  if (!isFinite(lo) || !isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  let range = hi - lo;
  if (range <= 0) {
    range = Math.abs(hi) || 1;
    lo = hi - range / 2;
    hi = lo + range;
  }
  lo -= range * 0.06;
  hi += range * 0.06;
  const span = hi - lo;
  const yOf = (price: number) => plotTop + ((hi - price) / span) * plotH;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  );
  parts.push(
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${p.bgFrom}"/><stop offset="1" stop-color="${p.bgTo}"/>` +
      `</linearGradient></defs>`,
  );
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bg)"/>`);

  // ---- candles ----
  const n = bars.length;
  const slot = plotW / n;
  const bodyW = Math.max(1, slot * (1 - s.gapFrac));
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const cx = plotLeft + slot * (i + 0.5);
    const color = b.c >= b.o ? p.up : p.down;
    parts.push(
      `<line x1="${r(cx)}" y1="${r(yOf(b.h))}" x2="${r(cx)}" y2="${r(yOf(b.l))}" ` +
        `stroke="${color}" stroke-width="${s.wick}"/>`,
    );
    const yo = yOf(b.o);
    const yc = yOf(b.c);
    const top = Math.min(yo, yc);
    const bh = Math.max(1, Math.abs(yc - yo));
    parts.push(
      `<rect x="${r(cx - bodyW / 2)}" y="${r(top)}" width="${r(bodyW)}" height="${r(bh)}" fill="${color}"/>`,
    );
  }

  // ---- header: ticker + interval (left), price + daily change (right) ----
  const last = bars[n - 1];
  const prev = n >= 2 ? bars[n - 2] : last; // standard "daily change" = vs previous close
  const base = prev.c !== 0 ? prev.c : last.o || 1;
  const delta = last.c - prev.c;
  const pct = (delta / base) * 100;
  const upTrend = delta >= 0;
  const changeColor = upTrend ? p.up : p.down;
  const arrow = upTrend ? "▲" : "▼";
  const sign = upTrend ? "+" : "-";

  const yLineA = s.padX + s.fTitle * 0.8;
  const yLineB = yLineA + s.fChange + s.padX * 0.3;
  const rightX = W - s.padX;

  parts.push(text(ticker, { x: plotLeft, y: yLineA, size: s.fTitle, fill: p.text, weight: 700 }));
  parts.push(
    text(`${abbrevInterval(interval)} · ${fmtQueried(now, o.tz, o.hr24)}`, {
      x: plotLeft,
      y: yLineB,
      size: s.fChange,
      fill: p.subtext,
    }),
  );
  parts.push(
    text(fmtPrice(last.c), { x: rightX, y: yLineA, size: s.fPrice, fill: p.text, weight: 700, anchor: "end" }),
  );
  parts.push(
    text(`${arrow} ${sign}${Math.abs(delta).toFixed(2)} (${sign}${Math.abs(pct).toFixed(2)}%)`, {
      x: rightX,
      y: yLineB,
      size: s.fChange,
      fill: changeColor,
      anchor: "end",
      weight: 700,
    }),
  );

  parts.push(`</svg>`);
  return parts.join("");
}

/** A minimal centered-message card, used for empty/error states. */
export function buildMessageSvg(
  message: string,
  o: Pick<ChartOptions, "width" | "height" | "theme" | "ticker">,
): string {
  const p = palette(o.theme);
  const { width: W, height: H } = o;
  const titleSize = Math.round(Math.min(W, H) * 0.07);
  const msgSize = Math.round(Math.min(W, H) * 0.05);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bgFrom}"/><stop offset="1" stop-color="${p.bgTo}"/></linearGradient></defs>` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bg)"/>` +
    text(o.ticker || "—", {
      x: W / 2,
      y: H / 2 - msgSize * 0.4,
      size: titleSize,
      fill: p.text,
      anchor: "middle",
      weight: 700,
    }) +
    text(message, {
      x: W / 2,
      y: H / 2 + titleSize * 0.8,
      size: msgSize,
      fill: p.subtext,
      anchor: "middle",
    }) +
    `</svg>`
  );
}
