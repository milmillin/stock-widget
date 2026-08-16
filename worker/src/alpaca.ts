export interface Bar {
  t: string; // RFC-3339 timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export interface FetchBarsParams {
  ticker: string;
  timeframe: string;
  limit: number;
  feed: string;
  keyId: string;
  secretKey: string;
}

export class AlpacaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AlpacaError";
    this.status = status;
  }
}

const DATA_URL = "https://data.alpaca.markets/v2/stocks/bars";

/**
 * Alpaca timeframe units. A timeframe is a positive integer + unit, e.g.
 * "1Day", "5Min", "1Hour". Limits per Alpaca: Min 1-59, Hour 1-23, others 1-N.
 */
const UNIT_LIMITS: Record<string, number> = {
  Min: 59,
  Hour: 23,
  Day: 1,
  Week: 1,
  Month: 12,
};

/** Validate + normalize an Alpaca timeframe string; returns null if invalid. */
export function normalizeTimeframe(raw: string | undefined): string | null {
  if (!raw) return "1Day";
  const m = /^(\d{1,2})(Min|Hour|Day|Week|Month)$/i.exec(raw.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = (m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()) as keyof typeof UNIT_LIMITS;
  if (n < 1 || n > UNIT_LIMITS[unit]) return null;
  return `${n}${unit}`;
}

export const VALID_FEEDS = ["iex", "sip"] as const;

const DAY_MS = 86400000;
const TRADING_MIN_PER_DAY = 390; // ~6.5h regular session

/**
 * Calendar lookback (as YYYY-MM-DD) wide enough to contain `limit` bars of the
 * given timeframe, with a cushion for nights/weekends/holidays. `sort=desc` +
 * `limit` then caps the response to the most recent N, so over-shooting is free.
 */
function lookbackStart(timeframe: string, limit: number): string {
  const m = /^(\d{1,2})(Min|Hour|Day|Week|Month)$/.exec(timeframe);
  const n = m ? parseInt(m[1], 10) : 1;
  const unit = m ? m[2] : "Day";
  let days: number;
  switch (unit) {
    case "Min":
      days = Math.ceil((limit * n) / TRADING_MIN_PER_DAY) * 2 + 5;
      break;
    case "Hour":
      days = Math.ceil((limit * n) / 6.5) * 2 + 5;
      break;
    case "Week":
      days = limit * n * 7 + 10;
      break;
    case "Month":
      days = limit * n * 31 + 31;
      break;
    default: // Day
      days = Math.ceil(limit * n * 1.5) + 7;
  }
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Fetch the most-recent `limit` OHLC bars for `ticker`, in chronological order.
 * Requests newest-first (sort=desc) over an explicit lookback window, then reverses.
 */
export async function fetchBars(p: FetchBarsParams): Promise<Bar[]> {
  const url = new URL(DATA_URL);
  url.searchParams.set("symbols", p.ticker);
  url.searchParams.set("timeframe", p.timeframe);
  url.searchParams.set("limit", String(p.limit));
  url.searchParams.set("feed", p.feed);
  url.searchParams.set("sort", "desc");
  url.searchParams.set("start", lookbackStart(p.timeframe, p.limit));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        "APCA-API-KEY-ID": p.keyId,
        "APCA-API-SECRET-KEY": p.secretKey,
        Accept: "application/json",
      },
    });
  } catch {
    throw new AlpacaError("Network error reaching Alpaca", 502);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg: string;
    if (res.status === 401 || res.status === 403) msg = "Invalid API key or plan";
    else if (res.status === 429) msg = "Rate limited";
    else if (res.status === 422) msg = "Bad request (check ticker/interval)";
    else msg = `Alpaca error ${res.status}`;
    throw new AlpacaError(body ? `${msg}: ${body.slice(0, 160)}` : msg, res.status);
  }

  const data = (await res.json()) as { bars?: Record<string, Bar[]> };
  const bars = data.bars?.[p.ticker] ?? [];
  // Alpaca returned newest-first (sort=desc); reverse to chronological order.
  return bars.slice().reverse();
}
