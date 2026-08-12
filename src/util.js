import crypto from "node:crypto";

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const hmac = (secret, value) => crypto.createHmac("sha256", secret).update(value).digest("base64url");
export const timingSafeEqualText = (a = "", b = "") => {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n)));
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...headers }
});
export const parseCookies = (req) => Object.fromEntries((req.headers.get("cookie") || "").split(";").filter(Boolean).map((part) => {
  const i = part.indexOf("=");
  return [decodeURIComponent(part.slice(0, i).trim()), decodeURIComponent(part.slice(i + 1).trim())];
}));
export const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export const normalizeUrl = (value) => {
  const u = new URL(value);
  u.hash = "";
  return u.toString();
};
