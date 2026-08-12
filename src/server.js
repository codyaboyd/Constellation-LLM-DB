import fs from "node:fs";
import path from "node:path";
import { applyManagedSettings, config, managedSettingsSnapshot, normalizeManagedSettings, roleCapabilities, serializeManagedSetting } from "./config.js";
import { initAuth, createSessionHeaders, clearSessionHeaders, requireAuth, requireCluster } from "./auth.js";
import { json } from "./util.js";
import { parseUpload } from "./services/parsers.js";
import { crawlSite } from "./services/crawler.js";
import { ingestText, deleteKnowledge, queryKnowledge, knowledgeList, knowledgeChunks, applyReplication, buildDocumentReplicationEvent } from "./services/knowledge.js";
import { computeEmbed, computeRerank, heartbeatPeers, linkPeer, nodeInfo, normalizePeerPriority, normalizePeerUrl, peers, processReplicationOutbox, replicateToPeer, unlinkPeer } from "./services/cluster.js";
import { embeddingInfo, warmEmbedding } from "./services/embedding.js";
import { rerankerInfo, warmReranker } from "./services/rerank.js";
import { modelRuntimeInfo } from "./services/model-runtime.js";
import { lanceStats, maybeCreateVectorIndex } from "./services/lance.js";
import { setSetting } from "./db/meta.js";

const auth = await initAuth();
const publicDir = path.resolve(process.cwd(), "public");
const bootstrapDir = path.resolve(process.cwd(), "node_modules/bootstrap/dist");

function staticFile(name, type) {
  const p = path.join(publicDir, name);
  return new Response(Bun.file(p), { headers: { "content-type": type, "cache-control": "no-cache" } });
}
function vendorFile(name, type) {
  const p = path.join(bootstrapDir, name);
  return new Response(Bun.file(p), { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
}
function denied(check) { return json({ error: check.error }, check.status); }
async function bodyJson(req) { try { return await req.json(); } catch { return {}; } }

async function handler(req) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  try {
    if (req.method === "GET" && pathname === "/health") return json({ ok: true, role: config.node.role });
    if (req.method === "GET" && pathname === "/") return staticFile("index.html", "text/html; charset=utf-8");
    if (req.method === "GET" && pathname === "/app.js") return staticFile("app.js", "application/javascript; charset=utf-8");
    if (req.method === "GET" && pathname === "/styles.css") return staticFile("styles.css", "text/css; charset=utf-8");
    if (req.method === "GET" && pathname === "/favicon.png") return staticFile("favicon.png", "image/png");
    if (req.method === "GET" && pathname === "/vendor/bootstrap.min.css") return vendorFile("css/bootstrap.min.css", "text/css; charset=utf-8");
    if (req.method === "GET" && pathname === "/vendor/bootstrap.bundle.min.js") return vendorFile("js/bootstrap.bundle.min.js", "application/javascript; charset=utf-8");

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const { password } = await bodyJson(req);
      if (!(await Bun.password.verify(String(password || ""), auth.passwordHash))) return json({ error: "Invalid password" }, 401);
      const session = createSessionHeaders();
      session.headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ ok: true, csrf: session.csrf }), { status: 200, headers: session.headers });
    }
    if (req.method === "POST" && pathname === "/api/auth/logout") {
      const headers = clearSessionHeaders();
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (pathname.startsWith("/internal/")) {
      if (!requireCluster(req)) return json({ error: "Cluster authentication failed" }, 401);
      if (req.method === "GET" && pathname === "/internal/node-info") return json(nodeInfo());
      if (req.method === "POST" && pathname === "/internal/compute/embed") {
        if (!roleCapabilities().embed) return json({ error: "This node does not advertise embedding compute." }, 403);
        const { inputs } = await bodyJson(req);
        if (!Array.isArray(inputs) || !inputs.length || inputs.some((input) => !String(input ?? "").trim())) return json({ error: "inputs must be a non-empty array of text." }, 400);
        return json({ vectors: await computeEmbed(inputs, { forceLocal: true }), info: embeddingInfo() });
      }
      if (req.method === "POST" && pathname === "/internal/compute/rerank") {
        if (!roleCapabilities().rerank) return json({ error: "This node does not advertise reranking compute." }, 403);
        const { query, documents, options } = await bodyJson(req);
        if (!String(query || "").trim()) return json({ error: "query is required for ranking." }, 400);
        return json({ result: await computeRerank(query, documents || [], options || {}, { forceLocal: true }) });
      }
      if (req.method === "POST" && pathname === "/internal/replicate") {
        if (!roleCapabilities().storage) return json({ error: "This node is not storage-capable." }, 403);
        return json(await applyReplication(await bodyJson(req)));
      }
      return json({ error: "Internal route not found" }, 404);
    }

    if (req.method === "GET" && pathname === "/api/status") {
      const check = requireAuth(req, auth); if (!check.ok) return denied(check);
      return json({ node: nodeInfo(), capabilities: roleCapabilities(), vectorStore: await lanceStats(), peers: peers().length });
    }
    if (req.method === "GET" && pathname === "/api/models") {
      const check = requireAuth(req, auth); if (!check.ok) return denied(check);
      return json({ runtime: modelRuntimeInfo(), embedding: embeddingInfo(), reranker: rerankerInfo() });
    }
    if (req.method === "GET" && pathname === "/api/settings") {
      const check = requireAuth(req, auth); if (!check.ok) return denied(check);
      return json(managedSettingsSnapshot());
    }
    if (req.method === "PUT" && pathname === "/api/settings") {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      const body = await bodyJson(req);
      const values = normalizeManagedSettings(body.settings || body, { clearSecrets: Array.isArray(body.clearSecrets) ? body.clearSecrets : [] });
      for (const [key, value] of Object.entries(values)) setSetting(key, serializeManagedSetting(key, value));
      applyManagedSettings(values);
      return json({ ...managedSettingsSnapshot(), saved: Object.keys(values) });
    }
    if (req.method === "POST" && pathname === "/api/models/preload") {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      const caps = roleCapabilities();
      const result = {};
      if (caps.embed) result.embedding = await warmEmbedding();
      if (caps.rerank) result.reranker = await warmReranker();
      return json({ runtime: modelRuntimeInfo(), ...result });
    }
    if (req.method === "GET" && pathname === "/api/knowledge") {
      const check = requireAuth(req, auth); if (!check.ok) return denied(check);
      return json({ documents: knowledgeList() });
    }
    const chunksMatch = pathname.match(/^\/api\/knowledge\/([^/]+)\/chunks$/);
    if (req.method === "GET" && chunksMatch) {
      const check = requireAuth(req, auth); if (!check.ok) return denied(check);
      return json(await knowledgeChunks(decodeURIComponent(chunksMatch[1])));
    }
    if (req.method === "POST" && pathname === "/api/knowledge/manual") {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      const body = await bodyJson(req);
      return json(await ingestText({ title: body.title || "Manual entry", text: body.text, sourceType: "manual", metadata: body.metadata || {}, chunkSize: body.chunkSize, overlap: body.overlap }), 201);
    }
    if (req.method === "POST" && pathname === "/api/knowledge/upload") {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "file is required" }, 400);
      const parsed = await parseUpload(file);
      const result = await ingestText({ title: String(form.get("title") || file.name), text: parsed.text, sourceType: parsed.sourceType, sourceUri: file.name, chunkSize: Number(form.get("chunkSize")) || 1200, overlap: Number(form.get("overlap")) || 180 });
      return json(result, 201);
    }
    if (req.method === "POST" && pathname === "/api/knowledge/crawl") {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      const body = await bodyJson(req);
      const pages = await crawlSite(body.url, body);
      const results = [];
      for (const page of pages) results.push(await ingestText({ title: page.title, text: page.text, sourceType: "web", sourceUri: page.url, metadata: { crawlRoot: body.url }, chunkSize: body.chunkSize, overlap: body.overlap }));
      return json({ pages: results.length, results }, 201);
    }
    const deleteMatch = pathname.match(/^\/api\/knowledge\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      return json(await deleteKnowledge(decodeURIComponent(deleteMatch[1])));
    }
    if (req.method === "POST" && pathname === "/api/query") {
      const check = requireAuth(req, auth); if (!check.ok) return denied(check);
      const body = await bodyJson(req);
      if (!String(body.query || "").trim()) return json({ error: "A question is required." }, 400);
      return json({ query: body.query, results: await queryKnowledge(body) });
    }
    if (req.method === "POST" && pathname === "/api/embeddings") {
      const check = requireAuth(req, auth); if (!check.ok) return denied(check);
      const body = await bodyJson(req);
      const inputs = body.inputs ?? body.input;
      const list = Array.isArray(inputs) ? inputs : [inputs].filter(Boolean);
      if (!list.length || list.some((input) => !String(input ?? "").trim())) return json({ error: "inputs must contain at least one non-empty text value." }, 400);
      return json({ model: embeddingInfo(), vectors: await computeEmbed(list) });
    }
    if (req.method === "POST" && pathname === "/api/rerank") {
      const check = requireAuth(req, auth); if (!check.ok) return denied(check);
      const body = await bodyJson(req);
      if (!String(body.query || "").trim()) return json({ error: "A question is required for ranking." }, 400);
      return json(await computeRerank(body.query, body.documents || [], { topN: body.topN, returnDocuments: body.returnDocuments !== false }));
    }
    if (req.method === "POST" && pathname === "/api/index/ensure") {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      return json(await maybeCreateVectorIndex());
    }
    if (req.method === "GET" && pathname === "/api/cluster/peers") {
      const check = requireAuth(req, auth); if (!check.ok) return denied(check);
      return json({ peers: peers() });
    }
    if (req.method === "POST" && pathname === "/api/cluster/peers") {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      const body = await bodyJson(req);
      if (!String(body.url || "").trim()) return json({ error: "A deployment address is required." }, 400);
      try { normalizePeerUrl(body.url); normalizePeerPriority(body.priority); } catch (error) { return json({ error: error.message }, 400); }
      return json({ peer: await linkPeer(body.url, body.priority) }, 201);
    }
    const peerSync = pathname.match(/^\/api\/cluster\/peers\/([^/]+)\/sync$/);
    if (req.method === "POST" && peerSync) {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      const peerId = decodeURIComponent(peerSync[1]);
      const peer = peers().find((p) => p.node_id === peerId);
      if (!peer) return json({ error: "Peer not found" }, 404);
      if (!peer.capabilities?.storage) return json({ error: "Peer is not storage-capable" }, 400);
      let synced = 0;
      let delivered = 0;
      let queuedForRetry = 0;
      for (const doc of knowledgeList()) {
        const event = await buildDocumentReplicationEvent(doc.id);
        if (await replicateToPeer(peerId, event)) delivered++;
        else queuedForRetry++;
        synced++;
      }
      return json({ syncedDocuments: synced, deliveredDocuments: delivered, queuedDocuments: queuedForRetry });
    }
    const peerDelete = pathname.match(/^\/api\/cluster\/peers\/([^/]+)$/);
    if (req.method === "DELETE" && peerDelete) {
      const check = requireAuth(req, auth, { mutate: true }); if (!check.ok) return denied(check);
      unlinkPeer(decodeURIComponent(peerDelete[1])); return json({ deleted: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || "Internal server error" }, 500);
  }
}

Bun.serve({ hostname: config.host, port: config.port, fetch: handler, maxRequestBodySize: 1024 * 1024 * 100 });
console.log(`[constellation] ${config.node.role} listening on ${config.host}:${config.port}`);
console.log(`[constellation] dashboard: ${config.node.publicBaseUrl}`);
console.log(`[constellation] model cache: ${config.models.cacheDir}`);
console.log(`[constellation] remote model access: ${config.models.allowRemote ? "enabled for cache fill" : "disabled (air-gap mode)"}`);

if (config.models.preload) {
  const caps = roleCapabilities();
  const preload = [];
  if (caps.embed) preload.push(warmEmbedding().then(() => console.log(`[constellation] local embedding model ready: ${config.embedding.model}`)));
  if (caps.rerank) preload.push(warmReranker().then(() => console.log(`[constellation] local reranker ready: ${config.rerank.model}`)));
  Promise.allSettled(preload).then((results) => {
    for (const result of results) if (result.status === "rejected") console.error("[constellation] model preload failed:", result.reason?.message || result.reason);
  });
}

setInterval(() => {
  if (!["gateway", "hybrid"].includes(config.node.role)) return;
  heartbeatPeers().catch(console.error);
  processReplicationOutbox().catch(console.error);
}, 5000);

if (["gateway", "hybrid"].includes(config.node.role)) {
  heartbeatPeers().catch(() => {});
  processReplicationOutbox().catch(() => {});
}
