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
iOS widget app  ──GET /chart.png?…──►  Cloudflare Worker  ──►  Alpaca market data API
                                          │  build SVG (candles)
                                          │  resvg-wasm → PNG
                     ◄──── image/png ─────┘
```

- Framework: **Hono**. Chart is hand-built **SVG** (`<rect>` bodies + `<line>` wicks) and
  rasterized with **`@cf-wasm/resvg`** (WASM, runs in the Workers runtime).
- Text uses a bundled, subset **Liberation Sans** (~9 KB per weight). Total Worker bundle
  ≈ 0.95 MB gzipped.

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
| `bars` | | `30` | number of candles, clamped 5–200 |
| `feed` | | `iex` | `iex` (free) or `sip` (paid Alpaca plan) |
| `theme` | | `dark` | `dark` or `light` |
| `key` | ✅* | — | Alpaca **API Key ID** |
| `secret` | ✅* | — | Alpaca **API Secret Key** |
| `format` | | `png` | `json` returns the raw bars (debugging) |

\* Credentials are read from the URL. Alternatively set them as Worker secrets (below) and
omit `key`/`secret` from the URL.

**Example**

```
https://stock-widget.you.workers.dev/chart.png?ticker=AAPL&interval=1Day&size=medium&bars=30&feed=iex&theme=dark&key=PK...&secret=...
```

Errors (bad ticker, invalid key, no data) render as a small message **image** (HTTP 200) so a
widget shows the reason instead of a broken image. Add `&format=json` to see the real error.

> ⚠️ **Security:** passing `secret` in the URL stores it in plaintext wherever that URL is
> saved (widget app, browser history, server logs). Use a **read-only** Alpaca key, or switch
> to Worker secrets (see below).

---

## Credentials to provide

### GitHub repository secrets
`Settings → Secrets and variables → Actions → New repository secret`:

| Secret | Where to get it |
|--------|-----------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → **My Profile → API Tokens** → template **"Edit Cloudflare Workers"** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → **Workers & Pages** (right sidebar) |

### GitHub Pages
`Settings → Pages → Build and deployment → Source = **GitHub Actions**`.

### Alpaca
Create a free account at [alpaca.markets](https://alpaca.markets), generate an **API Key ID +
Secret Key** (read-only/data is enough — the free **IEX** feed works). These are entered on the
preview site / in the widget URL — they are **not** stored in CI.

---

## Deploy

Push to `main`. Two workflows run:

- **`deploy-worker.yml`** — on changes under `worker/**`, runs `wrangler deploy`.
- **`deploy-pages.yml`** — on changes under `site/**`, publishes `site/` to GitHub Pages.

After the first Worker deploy you'll get a URL like `https://stock-widget.<subdomain>.workers.dev`.
Put it in **`site/config.js`** (`WORKER_BASE_URL`) so the preview page targets it by default.

---

## Local development

### Worker
Requires **Node 22+** (wrangler 4).

```bash
cd worker
npm install
npm run dev          # http://127.0.0.1:8787
npm run typecheck
```

Try it:

```bash
curl -o out.png "http://127.0.0.1:8787/chart.png?ticker=AAPL&size=medium&bars=30&feed=iex&key=YOUR_ID&secret=YOUR_SECRET"
```

### Preview site
No build step — just serve the folder:

```bash
cd site
python3 -m http.server 8000     # http://localhost:8000
```

Set the **Worker URL** field to `http://127.0.0.1:8787` to preview against your local worker.

---

## Optional: hide Alpaca keys as Worker secrets

If you'd rather not put credentials in the URL:

```bash
cd worker
npx wrangler secret put ALPACA_KEY_ID
npx wrangler secret put ALPACA_SECRET
```

The Worker falls back to these when `key`/`secret` are absent from the URL, so the widget URL
becomes just `…/chart.png?ticker=AAPL&size=medium`.

---

## Put it on your iPhone

1. Open the preview site, configure the chart, **Copy URL**.
2. In a widget app that supports a remote image URL (Scriptable, Widgy, "photo from URL", …),
   paste the URL and choose the matching widget size.
3. The image refreshes on whatever schedule the widget app allows.

---

Market data by [Alpaca](https://alpaca.markets). Not affiliated. Not investment advice.
