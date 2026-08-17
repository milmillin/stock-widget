#!/usr/bin/env node
// Generate an RSA-OAEP key pair for encrypting Alpaca credentials in the widget URL,
// writing everything through the repo-root .env (the source of truth):
//   • .env               PUBLIC_KEY + PRIVATE_KEY  (WORKER_BASE_URL preserved)
//   • site/config.js      regenerated from .env      (public, committed)
//   • worker/.dev.vars    PRIVATE_KEY                (secret, gitignored)
// For production, also run:  cd worker && npx wrangler secret put PRIVATE_KEY
//
// Usage:  node scripts/keygen.mjs
import { webcrypto as wc } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "./build-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

const { subtle } = wc;
const pair = await subtle.generateKey(
  { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["encrypt", "decrypt"],
);
const toB64 = (buf) => Buffer.from(new Uint8Array(buf)).toString("base64");
const pub = toB64(await subtle.exportKey("spki", pair.publicKey));
const priv = toB64(await subtle.exportKey("pkcs8", pair.privateKey));

const upsert = (text, key, val) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${val}`;
  if (re.test(text)) return text.replace(re, line);
  return (text && !text.endsWith("\n") ? text + "\n" : text) + line + "\n";
};

// --- .env : keep WORKER_BASE_URL, set the new keys ---
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (!/^WORKER_BASE_URL=/m.test(env)) {
  env = upsert(env, "WORKER_BASE_URL", "https://stock-widget.YOUR-SUBDOMAIN.workers.dev");
}
env = upsert(env, "PUBLIC_KEY", pub);
env = upsert(env, "PRIVATE_KEY", priv);
fs.writeFileSync(envPath, env);

// Regenerate site/config.js and sync PRIVATE_KEY into worker/.dev.vars from .env.
buildConfig();

console.log("\nGenerated RSA-OAEP 2048 key pair -> .env, worker/.dev.vars, site/config.js");
console.log("For production set the same private key as a Worker secret:");
console.log("  cd worker && npx wrangler secret put PRIVATE_KEY");
