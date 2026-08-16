import type { Bar } from "./alpaca";
import type { WidgetSize } from "./sizes";

export interface ChartOptions {
  width: number;
  height: number;
  theme: "dark" | "light";
  ticker: string;
  interval: string;
  feed: string;
  size: WidgetSize;
}

interface Palette {
  bg: string;
  grid: string;
  text: string;
  subtext: string;
  up: string;
  down: string;
}

function palette(theme: "dark" | "light"): Palette {
  if (theme === "light") {
    return {
      bg: "#ffffff",
      grid: "#e6eaee",
      text: "#0d1117",
      subtext: "#6b7280",
      up: "#12a969",
      down: "#e5484d",
    };
  }
  return {
    bg: "#0d1117",
    grid: "#222a33",
    text: "#e6edf3",
    subtext: "#8b949e",
    up: "#26a69a",
    down: "#ef5350",
  };
}

interface Style {
  padX: number;
  padTop: number;
  padBottom: number;
  rightAxis: number;
  fTitle: number;
  fPrice: number;
  fChange: number;
  fAxis: number;
  fFoot: number;
  gapFrac: number;
  wick: number;
  grid: number;
  xTicks: number;
}

const STYLES: Record<WidgetSize, Style> = {
  small: { padX: 18, padTop: 82, padBottom: 40, rightAxis: 70, fTitle: 31, fPrice: 31, fChange: 19, fAxis: 17, fFoot: 15, gapFrac: 0.3, wick: 1.6, grid: 3, xTicks: 2 },
  medium: { padX: 28, padTop: 104, padBottom: 54, rightAxis: 112, fTitle: 42, fPrice: 44, fChange: 25, fAxis: 22, fFoot: 19, gapFrac: 0.32, wick: 2.2, grid: 4, xTicks: 3 },
  large: { padX: 36, padTop: 146, padBottom: 76, rightAxis: 132, fTitle: 58, fPrice: 60, fChange: 34, fAxis: 28, fFoot: 26, gapFrac: 0.34, wick: 2.8, grid: 6, xTicks: 4 },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const r = (n: number) => Math.round(n * 100) / 100;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function fmtPrice(n: number): string {
  const a = Math.abs(n);
  const d = a >= 1 ? 2 : 4;
  return n.toFixed(d);
}

function fmtAxisTime(iso: string, intraday: boolean): string {
  const d = new Date(iso);
  if (intraday) {
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
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

/** Build a candlestick chart as an SVG string sized exactly to width x height px. */
export function buildChartSvg(bars: Bar[], o: ChartOptions): string {
  const { width: W, height: H, ticker, interval } = o;
  const p = palette(o.theme);
  const s = STYLES[o.size];
  const intraday = /Min|Hour/i.test(interval);

  const plotLeft = s.padX;
  const plotRight = W - s.padX - s.rightAxis;
  const plotTop = s.padTop;
  const plotBottom = H - s.padBottom;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  // ---- price domain (with headroom) ----
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

  const cardR = Math.round(Math.min(W, H) * 0.055);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  );
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="${cardR}" fill="${p.bg}"/>`);

  // ---- gridlines + right-axis price labels ----
  for (let g = 0; g < s.grid; g++) {
    const frac = g / (s.grid - 1);
    const gy = plotTop + frac * plotH;
    const price = hi - frac * span;
    parts.push(
      `<line x1="${r(plotLeft)}" y1="${r(gy)}" x2="${r(plotRight)}" y2="${r(gy)}" ` +
        `stroke="${p.grid}" stroke-width="1"/>`,
    );
    parts.push(
      text(fmtPrice(price), {
        x: plotRight + s.padX * 0.35,
        y: gy + s.fAxis * 0.34,
        size: s.fAxis,
        fill: p.subtext,
        anchor: "start",
      }),
    );
  }

  // ---- candles ----
  const n = bars.length;
  const slot = plotW / n;
  const bodyW = Math.max(1, slot * (1 - s.gapFrac));
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const cx = plotLeft + slot * (i + 0.5);
    const up = b.c >= b.o;
    const color = up ? p.up : p.down;
    // wick
    parts.push(
      `<line x1="${r(cx)}" y1="${r(yOf(b.h))}" x2="${r(cx)}" y2="${r(yOf(b.l))}" ` +
        `stroke="${color}" stroke-width="${s.wick}"/>`,
    );
    // body
    const yo = yOf(b.o);
    const yc = yOf(b.c);
    const top = Math.min(yo, yc);
    const bh = Math.max(1, Math.abs(yc - yo));
    parts.push(
      `<rect x="${r(cx - bodyW / 2)}" y="${r(top)}" width="${r(bodyW)}" height="${r(bh)}" ` +
        `fill="${color}"/>`,
    );
  }

  // ---- x-axis date/time labels ----
  const xLabelY = plotBottom + s.fFoot + s.padX * 0.5;
  const ticks = Math.min(s.xTicks, n);
  for (let k = 0; k < ticks; k++) {
    const idx = ticks === 1 ? n - 1 : Math.round((k * (n - 1)) / (ticks - 1));
    let x = plotLeft + slot * (idx + 0.5);
    let anchor: "start" | "middle" | "end" = "middle";
    if (k === 0) {
      x = plotLeft;
      anchor = "start";
    } else if (k === ticks - 1) {
      x = plotRight;
      anchor = "end";
    }
    parts.push(
      text(fmtAxisTime(bars[idx].t, intraday), {
        x,
        y: xLabelY,
        size: s.fFoot,
        fill: p.subtext,
        anchor,
      }),
    );
  }

  // ---- header: ticker + interval (left), last price + change (right) ----
  const first = bars[0];
  const last = bars[n - 1];
  const delta = last.c - first.c;
  const pct = first.c !== 0 ? (delta / first.c) * 100 : 0;
  const upTrend = delta >= 0;
  const changeColor = upTrend ? p.up : p.down;
  const arrow = upTrend ? "▲" : "▼"; // ▲ / ▼
  const sign = upTrend ? "+" : "-";

  const yLineA = s.padX + s.fTitle * 0.8;
  const yLineB = yLineA + s.fChange + s.padX * 0.3;

  parts.push(text(ticker, { x: plotLeft, y: yLineA, size: s.fTitle, fill: p.text, weight: 700 }));
  parts.push(
    text(`${interval}${intraday ? "" : " bars"} · ${o.feed}`, {
      x: plotLeft,
      y: yLineB,
      size: s.fChange,
      fill: p.subtext,
    }),
  );

  const rightX = W - s.padX;
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

  // ---- source attribution (bottom-right, short so it stays in the axis gutter) ----
  parts.push(
    text("Alpaca", {
      x: rightX,
      y: xLabelY,
      size: s.fFoot * 0.9,
      fill: p.subtext,
      anchor: "end",
      opacity: 0.7,
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
  const cardR = Math.round(Math.min(W, H) * 0.055);
  const titleSize = Math.round(Math.min(W, H) * 0.07);
  const msgSize = Math.round(Math.min(W, H) * 0.05);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect x="0" y="0" width="${W}" height="${H}" rx="${cardR}" fill="${p.bg}"/>` +
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
