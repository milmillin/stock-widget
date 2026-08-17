#!/usr/bin/env node
// Generate site/config.js from the repo-root .env.
// The browser can't read .env directly, so .env (source of truth) is compiled into
// site/config.js (a committed artifact) which index.html loads before app.js.
//
// Usage:  node scripts/build-config.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const configPath = path.join(root, "site", "config.js");

export function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function buildConfig() {
  // Precedence: process.env (e.g. GitHub Actions secrets/vars) > .env file > default.
  const fileEnv = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, "utf8")) : {};
  const pick = (k, d) => process.env[k] || fileEnv[k] || d;
  const baseUrl = pick("WORKER_BASE_URL", "https://stock-widget.YOUR-SUBDOMAIN.workers.dev");
  const pub = pick("PUBLIC_KEY", "");
  fs.writeFileSync(
    configPath,
    `// GENERATED from .env by scripts/build-config.mjs — do not edit by hand.
// These values are PUBLIC (safe to commit). Loaded by index.html before app.js.
window.WORKER_BASE_URL = "${baseUrl}";
window.PUBLIC_KEY = "${pub}";
`,
  );
  console.log(`site/config.js <- .env  (WORKER_BASE_URL=${baseUrl})`);

  // Sync the private key into worker/.dev.vars for local `wrangler dev` (wrangler
  // reads .dev.vars, not .env). Skipped when no PRIVATE_KEY is present — e.g. in the
  // Pages CI build, which must never receive it. Existing ALPACA_* lines are kept.
  const priv = process.env.PRIVATE_KEY || fileEnv.PRIVATE_KEY || "";
  if (priv) {
    const devVarsPath = path.join(root, "worker", ".dev.vars");
    let dv = fs.existsSync(devVarsPath) ? fs.readFileSync(devVarsPath, "utf8") : "";
    dv = dv.replace(/^PRIVATE_KEY=.*$\n?/m, "");
    if (dv.length && !dv.endsWith("\n")) dv += "\n";
    fs.writeFileSync(devVarsPath, dv + `PRIVATE_KEY=${priv}\n`);
    console.log("worker/.dev.vars <- PRIVATE_KEY");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) buildConfig();
