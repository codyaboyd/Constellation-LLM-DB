import { config } from "./config.js";
import { getSetting, setSetting } from "./db/meta.js";
import { hmac, parseCookies, timingSafeEqualText, uuid } from "./util.js";

const COOKIE = "constellation_session";
const CSRF = "constellation_csrf";
const maxAge = 60 * 60 * 12;

export async function initAuth() {
  let passwordHash = config.dashboardPasswordHash || getSetting("admin_password_hash");
  if (!passwordHash) {
    if (!config.dashboardPassword) throw new Error("Set CONSTELLATION_PASSWORD or CONSTELLATION_PASSWORD_HASH before first boot.");
    passwordHash = await Bun.password.hash(config.dashboardPassword, { algorithm: "argon2id" });
    setSetting("admin_password_hash", passwordHash);
  }
  let apiKey = config.apiKey || getSetting("api_key");
  if (!apiKey) {
    apiKey = `cst_${uuid().replaceAll("-", "")}`;
    setSetting("api_key", apiKey);
    console.log(`[constellation] generated API key: ${apiKey}`);
  }
  return { passwordHash, apiKey };
}

export function createSessionHeaders() {
  const expires = Math.floor(Date.now() / 1000) + maxAge;
  const nonce = uuid();
  const payload = `${expires}.${nonce}`;
  const token = `${payload}.${hmac(config.sessionSecret, payload)}`;
  const csrf = uuid();
  const headers = new Headers();
  headers.append("set-cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`);
  headers.append("set-cookie", `${CSRF}=${encodeURIComponent(csrf)}; Path=/; SameSite=Strict; Max-Age=${maxAge}`);
  return { headers, csrf };
}

export function clearSessionHeaders() {
  const headers = new Headers();
  headers.append("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  headers.append("set-cookie", `${CSRF}=; Path=/; SameSite=Strict; Max-Age=0`);
  return headers;
}

function validSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expires, nonce, sig] = parts;
  if (Number(expires) < Date.now() / 1000) return false;
  const payload = `${expires}.${nonce}`;
  return timingSafeEqualText(sig, hmac(config.sessionSecret, payload));
}

export function authKind(req, auth) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const xKey = req.headers.get("x-api-key") || "";
  if ((bearer && timingSafeEqualText(bearer, auth.apiKey)) || (xKey && timingSafeEqualText(xKey, auth.apiKey))) return "api";
  if (validSession(req)) return "session";
  return null;
}

export function requireAuth(req, auth, { mutate = false } = {}) {
  const kind = authKind(req, auth);
  if (!kind) return { ok: false, status: 401, error: "Unauthorized" };
  if (kind === "session" && mutate) {
    const cookies = parseCookies(req);
    if (!cookies[CSRF] || !timingSafeEqualText(cookies[CSRF], req.headers.get("x-csrf-token") || "")) {
      return { ok: false, status: 403, error: "CSRF validation failed" };
    }
  }
  return { ok: true, kind };
}

export function requireCluster(req) {
  if (!config.node.clusterSecret) return false;
  return timingSafeEqualText(req.headers.get("x-constellation-cluster-secret") || "", config.node.clusterSecret);
}
