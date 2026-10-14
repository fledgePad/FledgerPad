// Airdrop whitelist: satu blob privat per wallet (wl/<address>.json).
// POST {address, handle, hp}  -> daftar;  GET ?address=0x.. -> cek status.
const { put, head, BlobNotFoundError } = require("@vercel/blob");

const CLOSES_AT = Date.parse("2026-10-21T14:00:00Z");
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

function send(res, code, body) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = code;
  res.end(JSON.stringify(body));
}

async function exists(path) {
  try { await head(path); return true; }
  catch (e) { if (e instanceof BlobNotFoundError || /does not exist/i.test((e && e.message) || "")) return false; throw e; }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 4096) throw new Error("too large"); }
  return JSON.parse(raw || "{}");
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const a = String((req.query && req.query.address) || "").trim();
      if (!ADDR.test(a)) return send(res, 400, { ok: false, error: "Enter a valid EVM address (0x + 40 hex)." });
      return send(res, 200, { ok: true, listed: await exists("wl/" + a.toLowerCase() + ".json") });
    }
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method not allowed" });
    if (Date.now() > CLOSES_AT) return send(res, 403, { ok: false, error: "The whitelist is closed." });

    let b;
    try { b = await readBody(req); } catch (e) { return send(res, 400, { ok: false, error: "Bad request" }); }
    if (b.hp) return send(res, 200, { ok: true, listed: true }); // honeypot

    const address = String(b.address || "").trim();
    const handle = String(b.handle || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?]/)[0];
    if (!ADDR.test(address)) return send(res, 400, { ok: false, error: "Enter a valid EVM address (0x + 40 hex)." });
    if (/^0x0{40}$/i.test(address)) return send(res, 400, { ok: false, error: "That address can't receive tokens." });
    if (!HANDLE.test(handle)) return send(res, 400, { ok: false, error: "Enter your X handle, like @fledgerpad." });

    const path = "wl/" + address.toLowerCase() + ".json";
    if (await exists(path)) return send(res, 200, { ok: true, listed: true, already: true });

    const rec = {
      address: address.toLowerCase(),
      handle: handle.toLowerCase(),
      at: new Date().toISOString(),
      country: req.headers["x-vercel-ip-country"] || "",
      ip: (req.headers["x-forwarded-for"] || "").split(",")[0].trim(),
    };
    try {
      await put(path, JSON.stringify(rec), { access: "private", addRandomSuffix: false, contentType: "application/json" });
    } catch (e) {
      if (await exists(path)) return send(res, 200, { ok: true, listed: true, already: true });
      throw e;
    }
    return send(res, 200, { ok: true, listed: true });
  } catch (e) {
    console.error("whitelist", e && e.message);
    return send(res, 500, { ok: false, error: "Something went wrong. Try again in a minute." });
  }
};
