import { lookup } from "node:dns/promises";
import { load } from "cheerio";
import { config } from "../config.js";
import { normalizeUrl } from "../util.js";

function isPrivateIp(ip) {
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const p = ip.split(".").map(Number);
  if (p.length !== 4) return false;
  return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

async function assertSafeUrl(value) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Crawler supports HTTP/HTTPS only.");
  if (!config.crawl.allowPrivate) {
    if (["localhost", "127.0.0.1", "::1"].includes(u.hostname)) throw new Error("Private/localhost crawling is disabled.");
    const addresses = await lookup(u.hostname, { all: true });
    if (addresses.some((x) => isPrivateIp(x.address))) throw new Error("Private-network crawling is disabled.");
  }
  return u;
}


async function safeFetch(value, init = {}) {
  let current = String(value);
  for (let i = 0; i < 6; i++) {
    await assertSafeUrl(current);
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current).toString();
  }
  throw new Error("Too many redirects while crawling.");
}

async function robotsDisallows(origin) {
  try {
    const r = await safeFetch(new URL("/robots.txt", origin), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const text = await r.text();
    const lines = text.split(/\r?\n/).map((x) => x.replace(/#.*/, "").trim()).filter(Boolean);
    let applies = false;
    const disallow = [];
    for (const line of lines) {
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k)) applies = v === "*";
      if (applies && /^disallow$/i.test(k) && v) disallow.push(v);
    }
    return disallow;
  } catch { return []; }
}

export async function crawlSite(startUrl, options = {}) {
  const start = await assertSafeUrl(startUrl);
  const maxPagesValue = options.maxPages === undefined || options.maxPages === null || options.maxPages === "" ? config.crawl.maxPages : Number(options.maxPages);
  const maxDepthValue = options.maxDepth === undefined || options.maxDepth === null || options.maxDepth === "" ? config.crawl.maxDepth : Number(options.maxDepth);
  const maxPages = Math.min(Number.isFinite(maxPagesValue) && maxPagesValue > 0 ? maxPagesValue : config.crawl.maxPages, 200);
  const maxDepth = Math.min(Number.isFinite(maxDepthValue) && maxDepthValue >= 0 ? maxDepthValue : config.crawl.maxDepth, 5);
  const sameOrigin = options.sameOrigin !== false;
  const disallow = await robotsDisallows(start.origin);
  const queue = [{ url: normalizeUrl(start.toString()), depth: 0 }];
  const seen = new Set();
  const pages = [];
  while (queue.length && pages.length < maxPages) {
    const next = queue.shift();
    if (seen.has(next.url) || next.depth > maxDepth) continue;
    seen.add(next.url);
    const u = await assertSafeUrl(next.url);
    if (disallow.some((p) => p !== "/" && u.pathname.startsWith(p)) || disallow.includes("/")) continue;
    const response = await safeFetch(u, { headers: { "user-agent": "ConstellationKnowledgeBot/0.1" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) continue;
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("text/plain")) continue;
    const raw = await response.text();
    if (Buffer.byteLength(raw) > config.crawl.maxBytesPerPage) continue;
    if (type.includes("text/plain")) {
      pages.push({ url: u.toString(), title: u.pathname, text: raw });
      continue;
    }
    const $ = load(raw);
    $("script,style,noscript,svg,nav,footer,form").remove();
    const title = $("title").first().text().trim() || $("h1").first().text().trim() || u.pathname;
    const text = $("body").text().replace(/\s+/g, " ").trim();
    if (text) pages.push({ url: u.toString(), title, text });
    if (next.depth < maxDepth) {
      $("a[href]").each((_, a) => {
        try {
          const child = new URL($(a).attr("href"), u);
          if (!["http:", "https:"].includes(child.protocol)) return;
          if (sameOrigin && child.origin !== start.origin) return;
          child.hash = "";
          const normalized = normalizeUrl(child.toString());
          if (!seen.has(normalized)) queue.push({ url: normalized, depth: next.depth + 1 });
        } catch {}
      });
    }
  }
  return pages;
}
