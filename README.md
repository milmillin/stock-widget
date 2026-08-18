# 📈 Stock Widget

A stock **candlestick chart** rendered to a PNG by a Cloudflare Worker, designed to be
displayed in an iOS Home Screen widget (via any app that shows a remote image from a URL —
e.g. Scriptable, Widgy, a "photo from URL" widget).

Two pieces:

| Part | What it is | Where it runs |
|------|------------|---------------|
| **`worker/`** | An endpoint that fetches OHLC data from Alpaca and returns a chart PNG | Cloudflare Workers |
| **`site/`** | A static page to preview the chart, tweak settings, and copy the widget URL | GitHub Pages |

A push to `main` auto-deploys each part via GitHub Actions.

---

## How it works

```
 preview site ──encrypt {key,secret} with PUBLIC_KEY──►  ?enc=… in the URL
                                                              │
 iOS widget app ──GET /chart.png?ticker=…&enc=…──►  Cloudflare Worker
                                                       │  decrypt enc with PRIVATE_KEY
                                                       │  fetch OHLC from Alpaca
                                                       │  build SVG candles → resvg-wasm → PNG
                                  ◄──────── image/png ─┘
```

- Framework: **Hono**. The chart is hand-built **SVG** (`<rect>` bodies + `<line>` wicks) and
  rasterized with **`@cf-wasm/resvg`** (WASM, runs in the Workers runtime). Text uses a bundled,
  subset **Liberation Sans**. Total Worker bundle ≈ 0.95 MB gzipped.
- Your Alpaca key/secret are **encrypted** (RSA-OAEP) with a public key before they go in the
  URL; only the Worker (with the private key) can read them — see [Keys & config](#keys--config).

### The chart

A minimalist quote card — no axes, gridlines, or price/date labels:

- **Header:** ticker + last price; below that, the abbreviated interval (`1D`, `15m`, `1H`) and
  the "last queried" time on the left, and the **daily change** (last close vs previous close,
  the standard convention) on the right, colored green/red.
- **Body:** candlesticks filling the width, on a subtle gradient background.
- Rendered at iOS **@3x**; corners are square (iOS masks the widget to its own radius).

---

## The endpoint

```
GET {WORKER_URL}/chart.png
```

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `ticker` | ✅ | — | e.g. `AAPL`, `MSFT`, `BRK.B` |
| `interval` | | `1Day` | Alpaca timeframe: `1Min`–`59Min`, `1Hour`–`23Hour`, `1Day`, `1Week`, `1Month`–`12Month` |
| `size` | | `medium` | `small` (507×507), `medium` (1092×507), `large` (1092×1146) — iOS @3x |
| `w`, `h` | | (size) | exact pixel dimensions (≥120) — overrides the `size` preset but keeps its styling, so a client renders it 1:1 (crisp). Used by the Scriptable widget to match the device's real widget size |
| `bars` | | `90` | number of candles, clamped 5–200 |
| `feed` | | `iex` | `iex` (free) or `sip` (paid Alpaca plan) — data source (not shown on the chart) |
| `theme` | | `dark` | `dark` or `light` |
| `tz` | | `UTC` | IANA timezone for the "last queried" time, e.g. `America/New_York` |
| `hr24` | | `0` | `1` = 24-hour clock (also accepts `24hr`) |
| `hl` | | `0` | `1` = newer-iOS specular rim highlight (bright top-left/bottom-right); `hlr` = corner radius in px |
| `ind` | | (none) | indicators, comma-separated `type[:p1[:p2…]]` — see below |
| `enc` | ✅* | — | RSA-OAEP-encrypted `{k,s}` credentials — what the preview site sends |
| `key` | ✅* | — | Alpaca **API Key ID** (raw alternative to `enc`) |
| `secret` | ✅* | — | Alpaca **API Secret** (raw alternative to `enc`) |
| `format` | | `png` | `json` returns the raw bars (debugging) |

\* Provide `enc`, **or** `key`+`secret`, **or** set `ALPACA_KEY_ID`/`ALPACA_SECRET` as Worker secrets.

Errors (bad ticker, invalid key, no data) render as a small message **image** (HTTP 200) so a
widget shows the reason instead of a broken image. Add `&format=json` to see the real error.

### Indicators (`ind`)

Comma-separated list; each entry is `type[:p1[:p2…]]`. Add any number (capped at 8; at most 3
oscillator panes render, extras ignored). **Overlays** draw on the price axis; **oscillators**
get their own stacked pane below the candles.

```
ind=sma:20,ema:50,bb:20:2,vwap,rsi:14,macd:12:26:9,stoch:14:3:3,vol
```

| Type | Params (defaults) | Kind | What it is |
|------|-------------------|------|------------|
| `sma` | `n` (20) | overlay | Simple moving average |
| `ema` | `n` (20) | overlay | Exponential moving average |
| `wma` | `n` (20) | overlay | Weighted moving average |
| `bb` | `n` (20), `k` (2) | overlay | Bollinger Bands (SMA ± *k*·σ), shaded band |
| `vwap` | — | overlay | Volume-weighted average price (intraday; resets each session) |
| `rsi` | `n` (14) | pane | Relative Strength Index (Wilder), 30/70 guides |
| `macd` | `fast` (12), `slow` (26), `signal` (9) | pane | MACD line + signal + histogram |
| `stoch` | `n` (14), `k` (3), `d` (3) | pane | Stochastic %K / %D, 20/80 guides |
| `vol` | — | pane | Volume bars (green/red by candle) |

**Warmup is automatic.** Most indicators need bars *before* the first displayed candle to be
correct (a 50-bar SMA needs 49 prior closes; Wilder RSI needs many more). The Worker fetches
`bars + warmup` from Alpaca, computes each series over the full set, then renders only the last
`bars` — so an indicator is drawn (and correct) from the very first visible candle.

> `vwap` is meaningful only on **intraday** intervals — on daily-and-longer bars each candle is
> its own session, so it collapses onto the price. Panes are cramped on the small square widget.

---

## Keys & config

Your Alpaca key/secret never appear in plaintext in a URL. The preview site encrypts them with
an **RSA-OAEP public key**; the Worker decrypts with the matching **private key**. If the URL
leaks, the ciphertext is useless without the private key. (Using a **paper** Alpaca key is still
safest — it can read market data but can't trade.)

Generate a key pair (one-time, or to rotate):

```bash
node scripts/keygen.mjs
```

**`.env` (repo root) is the single source of truth.** `node scripts/build-config.mjs` compiles
it into the runtime locations:

| Location | Holds | Committed? |
|----------|-------|-----------|
| **`.env`** | `WORKER_BASE_URL`, `PUBLIC_KEY`, `PRIVATE_KEY` — source of truth | no (gitignored) |
| **`site/config.js`** | `WORKER_BASE_URL`, `PUBLIC_KEY` (public) — generated from `.env` | no (generated) |
| **`worker/.dev.vars`** | `PRIVATE_KEY` for local `wrangler dev` (+ optional Alpaca fallback) | no (gitignored) |
| **Worker secrets** (Cloudflare) | `PRIVATE_KEY` in production | n/a |
| **GitHub Actions vars/secrets** | `WORKER_BASE_URL`, `PUBLIC_KEY` for the Pages build | n/a |

> ⚠️ The **private key must never reach GitHub Pages** — anything in the static site is public.
> It lives only in `worker/.dev.vars` (local) and as a Cloudflare Worker secret (prod).

---

## Credentials to provide (to deploy)

**GitHub → Settings → Secrets and variables → Actions**

| Name | Kind | Value |
|------|------|-------|
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare → My Profile → API Tokens → **"Edit Cloudflare Workers"** |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare → Workers & Pages (right sidebar) |
| `WORKER_BASE_URL` | Variable | your `https://stock-widget.<sub>.workers.dev` (public) |
| `PUBLIC_KEY` | Variable | the `PUBLIC_KEY` from your `.env` (public) |

**GitHub → Settings → Pages:** Source = **GitHub Actions**.

**Cloudflare** (Worker secret, not in git):
```bash
cd worker && npx wrangler secret put PRIVATE_KEY   # paste the value from worker/.dev.vars
```

**Alpaca:** create a free account at [alpaca.markets](https://alpaca.markets) and generate an
**API Key ID + Secret Key**. A **paper** key is recommended; the free **IEX** feed works.

---

## Deploy

Push to `main`. Two workflows run:

- **`deploy-worker.yml`** — on changes under `worker/**`, type-checks and runs `wrangler deploy`.
- **`deploy-pages.yml`** — on changes under `site/**`, builds `site/config.js` from your GitHub
  `WORKER_BASE_URL` + `PUBLIC_KEY`, then publishes `site/` to GitHub Pages.

---

## Local development

Requires **Node 22+** (wrangler 4).

**1. Generate keys** (writes `.env`, `site/config.js`, `worker/.dev.vars`):
```bash
node scripts/keygen.mjs
```

**2. (optional) Alpaca test creds** for local `curl` without encryption — add to `worker/.dev.vars`:
```
ALPACA_KEY_ID=PK...
ALPACA_SECRET=...
```

**3. Worker:**
```bash
cd worker
npm install
npm run dev          # http://127.0.0.1:8787
```
```bash
curl -o out.png "http://127.0.0.1:8787/chart.png?ticker=AAPL&size=medium&bars=30"   # uses .dev.vars creds
```

**4. Preview site** (no build step):
```bash
cd site
python3 -m http.server 8000     # http://localhost:8000
```
Set the **Worker URL** field to `http://127.0.0.1:8787`.

> After editing `.env`, run `node scripts/build-config.mjs` to regenerate `site/config.js`
> (and re-sync `PRIVATE_KEY` into `worker/.dev.vars`).

---

## Put it on your iPhone

### Option A — native Scriptable widget (recommended)

A [Scriptable](https://scriptable.app) script (`site/stock-widget.js`, served by Pages at
`https://<you>.github.io/<repo>/stock-widget.js`) renders the widget natively and adds an in-app
setup screen.

1. Install the free **Scriptable** app.
2. Add the script — copy `stock-widget.js` into a new Scriptable script, or install via
   [ScriptDude](https://scriptdu.de) with the source URL above (one-tap install + auto-update).
3. Run it once in Scriptable → set your **Worker URL** + **Alpaca keys** (stored in the iOS
   **Keychain**) → **Preview**.
4. Add a Scriptable widget to the Home Screen; set its **Parameter** to pick the symbol per
   widget — `TSLA`, or `MSFT,15Min,60`, or `{"ticker":"NVDA","interval":"1Week"}`.

Credentials go straight to your Worker over HTTPS (never in a shared URL). Scriptable has no Web
Crypto, so it uses the Worker's raw `key`/`secret` params rather than `enc`.

### Option B — any photo-from-URL widget

1. Open the preview site, configure the chart, **Copy URL**.
2. Paste it into a widget app that shows a remote image (Widgy, a "photo from URL" widget, …) and
   pick the matching size.

Either way, the refresh cadence is controlled by iOS.

---

Market data by [Alpaca](https://alpaca.markets). Not affiliated. Not investment advice.
