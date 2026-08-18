import type { Bar } from "./alpaca";

// ---------- specs ----------
export interface IndicatorSpec {
  type: string; // sma ema wma bb vwap rsi macd stoch vol
  params: number[];
  color: string; // overlay line color (panes use fixed colors)
}

const OVERLAY_TYPES = new Set(["sma", "ema", "wma", "bb", "vwap"]);
const PANE_TYPES = new Set(["rsi", "macd", "stoch", "vol"]);
const KNOWN = new Set([...OVERLAY_TYPES, ...PANE_TYPES]);

const DEFAULTS: Record<string, number[]> = {
  sma: [20], ema: [20], wma: [20], bb: [20, 2], vwap: [],
  rsi: [14], macd: [12, 26, 9], stoch: [14, 3, 3], vol: [],
};

// Distinct colors cycled across overlays (Bollinger/VWAP reuse their line color).
const OVERLAY_COLORS = ["#f5a623", "#4aa3ff", "#c774f0", "#ff6ea9", "#38d39f", "#ffd24a"];

// A spec token that is 6 hex digits (optional leading #) is a custom color, not a param.
// Periods are capped at 400 (≤3 digits), so this never collides with a real parameter.
const COLOR_RE = /^#?[0-9a-f]{6}$/;

export function parseIndicators(param: string | undefined): IndicatorSpec[] {
  if (!param) return [];
  const specs: IndicatorSpec[] = [];
  let overlayIdx = 0;
  for (const raw of param.split(",")) {
    const parts = raw.trim().toLowerCase().split(":");
    const type = parts[0];
    if (!KNOWN.has(type)) continue;
    let userColor = "";
    const nums: number[] = [];
    for (const tok of parts.slice(1)) {
      if (!userColor && COLOR_RE.test(tok)) {
        userColor = tok.startsWith("#") ? tok : "#" + tok;
        continue;
      }
      const x = parseFloat(tok);
      if (Number.isFinite(x) && x > 0) nums.push(Math.min(x, 400));
    }
    const params = nums.length ? nums : DEFAULTS[type];
    let color = userColor;
    if (OVERLAY_TYPES.has(type)) {
      const auto = OVERLAY_COLORS[overlayIdx++ % OVERLAY_COLORS.length];
      if (!color) color = auto; // keep palette positions stable regardless of overrides
    }
    specs.push({ type, params, color });
    if (specs.length >= 8) break;
  }
  return specs;
}

function warmupOne(s: IndicatorSpec): number {
  const [a = 0, b = 0, c = 0] = s.params;
  switch (s.type) {
    case "sma":
    case "wma":
      return Math.ceil(a) - 1;
    case "bb":
      return Math.ceil(a);
    case "ema":
      return Math.ceil(a * 5);
    case "rsi":
      return Math.ceil(a * 10);
    case "macd":
      return Math.ceil(b * 5 + c);
    case "stoch":
      return Math.ceil(a + b + c);
    case "vwap":
      return 80; // cover a session at common intraday intervals
    default:
      return 0;
  }
}

export function warmupFor(specs: IndicatorSpec[]): number {
  let w = 0;
  for (const s of specs) w = Math.max(w, warmupOne(s));
  return Math.min(300, w);
}

// ---------- render shapes (chart.ts draws these; already display-sliced) ----------
export interface RenderLine {
  values: (number | null)[];
  color: string;
  width?: number;
  dash?: boolean;
}
export interface RenderIndicator {
  pane: "price" | "own";
  kind: string;
  label: string;
  lines?: RenderLine[];
  band?: { upper: (number | null)[]; lower: (number | null)[]; fill: string };
  bars?: { values: (number | null)[]; posColor: string; negColor: string; signs?: boolean[] };
  scale?: { min?: number; max?: number; guides?: { v: number }[] };
}

// ---------- series math ----------
type Nseries = (number | null)[];

function sma(c: number[], n: number): Nseries {
  const out: Nseries = new Array(c.length).fill(null);
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    sum += c[i];
    if (i >= n) sum -= c[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(c: number[], n: number): Nseries {
  const out: Nseries = new Array(c.length).fill(null);
  const mult = 2 / (n + 1);
  let prev = 0;
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    if (i < n - 1) {
      sum += c[i];
      continue;
    }
    if (i === n - 1) {
      sum += c[i];
      prev = sum / n;
    } else {
      prev = c[i] * mult + prev * (1 - mult);
    }
    out[i] = prev;
  }
  return out;
}

function wma(c: number[], n: number): Nseries {
  const out: Nseries = new Array(c.length).fill(null);
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < c.length; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += c[i - j] * (n - j);
    out[i] = s / denom;
  }
  return out;
}

function bollinger(c: number[], n: number, k: number): { mid: Nseries; upper: Nseries; lower: Nseries } {
  const mid = sma(c, n);
  const upper: Nseries = new Array(c.length).fill(null);
  const lower: Nseries = new Array(c.length).fill(null);
  for (let i = n - 1; i < c.length; i++) {
    const m = mid[i] as number;
    let s = 0;
    for (let j = 0; j < n; j++) {
      const d = c[i - j] - m;
      s += d * d;
    }
    const sd = Math.sqrt(s / n);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}

function vwap(bars: Bar[]): Nseries {
  const out: Nseries = new Array(bars.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  let day = "";
  for (let i = 0; i < bars.length; i++) {
    const d = bars[i].t.slice(0, 10); // UTC date -> session reset
    if (d !== day) {
      day = d;
      cumPV = 0;
      cumV = 0;
    }
    const tp = (bars[i].h + bars[i].l + bars[i].c) / 3;
    const v = bars[i].v || 0;
    cumPV += tp * v;
    cumV += v;
    out[i] = cumV > 0 ? cumPV / cumV : tp;
  }
  return out;
}

function rsi(c: number[], n: number): Nseries {
  const out: Nseries = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const ch = c[i] - c[i - 1];
    if (ch >= 0) g += ch;
    else l -= ch;
  }
  let avgG = g / n;
  let avgL = l / n;
  out[n] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = n + 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1];
    avgG = (avgG * (n - 1) + (ch > 0 ? ch : 0)) / n;
    avgL = (avgL * (n - 1) + (ch < 0 ? -ch : 0)) / n;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

// EMA over a series that may start with nulls (used for the MACD signal line).
function emaNullable(arr: Nseries, n: number): Nseries {
  const out: Nseries = new Array(arr.length).fill(null);
  const mult = 2 / (n + 1);
  let prev = 0;
  let count = 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) continue;
    count++;
    if (count < n) {
      sum += v;
      continue;
    }
    if (count === n) {
      sum += v;
      prev = sum / n;
    } else {
      prev = v * mult + prev * (1 - mult);
    }
    out[i] = prev;
  }
  return out;
}

// SMA over a series that may start with nulls (used for Stochastic %K/%D).
function smaNullable(arr: Nseries, n: number): Nseries {
  const out: Nseries = new Array(arr.length).fill(null);
  const buf: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) continue;
    buf.push(arr[i] as number);
    if (buf.length > n) buf.shift();
    if (buf.length === n) out[i] = buf.reduce((x, y) => x + y, 0) / n;
  }
  return out;
}

function macd(c: number[], f: number, s: number, sig: number): { macd: Nseries; signal: Nseries; hist: Nseries } {
  const ef = ema(c, f);
  const es = ema(c, s);
  const line: Nseries = c.map((_, i) => (ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : null));
  const signal = emaNullable(line, sig);
  const hist: Nseries = line.map((m, i) => (m != null && signal[i] != null ? m - (signal[i] as number) : null));
  return { macd: line, signal, hist };
}

function stochastic(bars: Bar[], n: number, k: number, d: number): { k: Nseries; d: Nseries } {
  const raw: Nseries = new Array(bars.length).fill(null);
  for (let i = n - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = 0; j < n; j++) {
      if (bars[i - j].h > hh) hh = bars[i - j].h;
      if (bars[i - j].l < ll) ll = bars[i - j].l;
    }
    raw[i] = hh === ll ? 50 : ((bars[i].c - ll) / (hh - ll)) * 100;
  }
  const kLine = smaNullable(raw, k);
  const dLine = smaNullable(kLine, d);
  return { k: kLine, d: dLine };
}

// ---------- dispatch + slice ----------
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function renderOne(spec: IndicatorSpec, bars: Bar[], c: number[]): RenderIndicator | null {
  const [a = 0, b = 0, d = 0] = spec.params;
  const col = spec.color || "#f5a623";
  switch (spec.type) {
    case "sma":
      return { pane: "price", kind: "sma", label: `SMA ${a}`, lines: [{ values: sma(c, a), color: col, width: 1.5 }] };
    case "ema":
      return { pane: "price", kind: "ema", label: `EMA ${a}`, lines: [{ values: ema(c, a), color: col, width: 1.5 }] };
    case "wma":
      return { pane: "price", kind: "wma", label: `WMA ${a}`, lines: [{ values: wma(c, a), color: col, width: 1.5 }] };
    case "bb": {
      const { mid, upper, lower } = bollinger(c, a, b);
      return {
        pane: "price", kind: "bb", label: `BB ${a},${b}`,
        band: { upper, lower, fill: hexA(col, 0.08) },
        lines: [
          { values: upper, color: col, width: 1 },
          { values: mid, color: col, width: 1, dash: true },
          { values: lower, color: col, width: 1 },
        ],
      };
    }
    case "vwap":
      return { pane: "price", kind: "vwap", label: "VWAP", lines: [{ values: vwap(bars), color: col, width: 1.5, dash: true }] };
    case "rsi":
      return {
        pane: "own", kind: "rsi", label: `RSI ${a}`,
        lines: [{ values: rsi(c, a), color: spec.color || "#b57edc", width: 1.5 }],
        scale: { min: 0, max: 100, guides: [{ v: 30 }, { v: 70 }] },
      };
    case "macd": {
      const m = macd(c, a, b, d);
      return {
        pane: "own", kind: "macd", label: "MACD",
        bars: { values: m.hist, posColor: "#26a69a", negColor: "#ef5350" },
        lines: [
          { values: m.macd, color: "#4aa3ff", width: 1.3 },
          { values: m.signal, color: "#f5a623", width: 1.3 },
        ],
        scale: { guides: [{ v: 0 }] },
      };
    }
    case "stoch": {
      const st = stochastic(bars, a, b, d);
      return {
        pane: "own", kind: "stoch", label: "Stoch",
        lines: [
          { values: st.k, color: "#4aa3ff", width: 1.3 },
          { values: st.d, color: "#f5a623", width: 1.3 },
        ],
        scale: { min: 0, max: 100, guides: [{ v: 20 }, { v: 80 }] },
      };
    }
    case "vol":
      return {
        pane: "own", kind: "vol", label: "Vol",
        bars: {
          values: bars.map((x) => x.v),
          posColor: "#26a69a",
          negColor: "#ef5350",
          signs: bars.map((x) => x.c >= x.o),
        },
        scale: { min: 0 },
      };
    default:
      return null;
  }
}

function sliceIndicator(r: RenderIndicator, d: number): RenderIndicator {
  const sl = <T>(arr: T[]) => arr.slice(-d);
  const out: RenderIndicator = { pane: r.pane, kind: r.kind, label: r.label, scale: r.scale };
  if (r.lines) out.lines = r.lines.map((l) => ({ ...l, values: sl(l.values) }));
  if (r.band) out.band = { upper: sl(r.band.upper), lower: sl(r.band.lower), fill: r.band.fill };
  if (r.bars) out.bars = { ...r.bars, values: sl(r.bars.values), signs: r.bars.signs ? sl(r.bars.signs) : undefined };
  return out;
}

/** Compute all indicators over the full (warmup+display) bars, sliced to the last `displayCount`. */
export function computeIndicators(specs: IndicatorSpec[], allBars: Bar[], displayCount: number): RenderIndicator[] {
  const c = allBars.map((b) => b.c);
  const out: RenderIndicator[] = [];
  for (const spec of specs) {
    const r = renderOne(spec, allBars, c);
    if (r) out.push(sliceIndicator(r, displayCount));
  }
  return out;
}
