// RSA-OAEP decryption of the Alpaca credentials passed as the `enc` URL param.
// The preview site encrypts { k, s } (key id / secret) with the public key; only
// the Worker, holding the matching PKCS8 private key (env.PRIVATE_KEY), can read them.

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return b64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

// Import the private key once per isolate (keyed by value in case it changes).
let cache: { pkcs8: string; key: Promise<CryptoKey> } | null = null;

function privateKey(pkcs8b64: string): Promise<CryptoKey> {
  if (!cache || cache.pkcs8 !== pkcs8b64) {
    cache = {
      pkcs8: pkcs8b64,
      key: crypto.subtle.importKey(
        "pkcs8",
        b64ToBytes(pkcs8b64) as BufferSource,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["decrypt"],
      ),
    };
  }
  return cache.key;
}

export async function decryptCreds(
  enc: string,
  pkcs8b64: string,
): Promise<{ key: string; secret: string }> {
  const key = await privateKey(pkcs8b64);
  const plain = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, key, b64urlToBytes(enc) as BufferSource);
  const obj = JSON.parse(new TextDecoder().decode(plain)) as { k?: string; s?: string };
  if (!obj.k || !obj.s) throw new Error("Malformed credentials");
  return { key: obj.k, secret: obj.s };
}
