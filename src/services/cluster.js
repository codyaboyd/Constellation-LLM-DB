import os from "node:os";
import { config, roleCapabilities } from "../config.js";
import { ackReplication, dueReplication, ensureNodeId, failReplication, listPeers, outboxCount, queueReplication, removePeer as removePeerDb, setPeerHealth, upsertPeer } from "../db/meta.js";
import { embeddingFingerprint, embeddingInfo, embedLocal } from "./embedding.js";
import { rerankerFingerprint, rerankerInfo, rerankLocal } from "./rerank.js";
import { nowIso } from "../util.js";

export const nodeId = ensureNodeId();
let activeJobs = 0;
let heartbeatPromise = null;
let replicationPromise = null;

const roleDescriptions = Object.freeze({
  standalone: { label: "All-in-one", description: "Runs the dashboard, storage, and model work in one place." },
  gateway: { label: "Coordinator", description: "Coordinates requests, stores knowledge, and sends model work to workers." },
  worker: { label: "Model worker", description: "Does search-model work for other deployments; it does not store knowledge." },
  replica: { label: "Knowledge copy", description: "Keeps a copy of the knowledge; it does not run model work." },
  hybrid: { label: "Coordinator + worker", description: "Coordinates requests and can also do model work locally." }
});

const capabilityDescriptions = Object.freeze({
  storage: "Stores knowledge",
  embed: "Creates search representations",
  rerank: "Improves result order"
});

const healthDescriptions = Object.freeze({
  healthy: { label: "Connected", description: "Checked recently and ready to help." },
  degraded: { label: "Having trouble", description: "The last request failed; Constellation will try again after the next check." },
  offline: { label: "Offline", description: "No recent check-in. Work will stay local or be retried later." },
  unknown: { label: "Not checked yet", description: "Waiting for the first health check." }
});

function localLoad() {
  const cpus = Math.max(os.cpus().length, 1);
  return Math.max(0, os.loadavg()[0] / cpus);
}

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function nodeInfo() {
  const capabilities = roleCapabilities();
  const role = roleDescriptions[config.node.role] || { label: config.node.role, description: "Deployment role is not recognized." };
  return {
    nodeId,
    name: config.node.name,
    url: config.node.publicBaseUrl,
    role: config.node.role,
    roleLabel: role.label,
    roleDescription: role.description,
    capabilities,
    capabilityLabels: Object.entries(capabilities).filter(([key, enabled]) => enabled && capabilityDescriptions[key]).map(([key]) => capabilityDescriptions[key]),
    embedding: embeddingInfo(),
    reranker: rerankerInfo(),
    load: localLoad(),
    activeJobs,
    replicationOutbox: outboxCount()
  };
}

function clusterHeaders() {
  return { "content-type": "application/json", "x-constellation-cluster-secret": config.node.clusterSecret };
}

export function normalizePeerUrl(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("A deployment address is required.");
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("Deployment address must be a valid HTTP or HTTPS URL."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Deployment address must use HTTP or HTTPS.");
  if (!parsed.hostname) throw new Error("Deployment address must include a hostname.");
  if (parsed.search || parsed.hash) throw new Error("Deployment address must not include a query or fragment.");
  if (parsed.username || parsed.password) throw new Error("Deployment address must not contain a username or password.");
  return parsed.toString().replace(/\/+$/, "");
}

export function normalizePeerPriority(value, fallback = config.node.workerBasePriority) {
  if (value == null || String(value).trim() === "") return fallback;
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < 0 || priority > 1_000_000) {
    throw new Error("Preference must be a whole number from 0 to 1,000,000.");
  }
  return priority;
}

function parseCapabilities(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function effectivePeerStatus(peer) {
  const lastSeen = Date.parse(peer.last_seen || "");
  const fresh = Number.isFinite(lastSeen) && Date.now() - lastSeen <= config.node.heartbeatTtlMs * 2;
  if (peer.status === "healthy" && fresh) return "healthy";
  if (peer.status === "degraded" && fresh) return "degraded";
  if (!Number.isFinite(lastSeen)) return "unknown";
  return "offline";
}

export function describePeer(peer) {
  const capabilities = parseCapabilities(peer.capabilities_json ?? peer.capabilities);
  const status = effectivePeerStatus(peer);
  const role = roleDescriptions[peer.role] || { label: peer.role || "Unknown role", description: "This deployment has not shared a recognized role." };
  const health = healthDescriptions[status];
  const compatibility = {
    embedding: capabilities.embed ? (peer.embedding_fingerprint === embeddingFingerprint ? "compatible" : "different-model") : "not-supported",
    reranking: capabilities.rerank ? (peer.reranker_fingerprint === rerankerFingerprint ? "compatible" : "different-model") : "not-supported"
  };
  const lastSeen = Date.parse(peer.last_seen || "");
  return {
    ...peer,
    capabilities,
    status,
    role_label: role.label,
    role_description: role.description,
    health_label: health.label,
    health_description: health.description,
    capability_labels: Object.entries(capabilities).filter(([key, enabled]) => enabled && capabilityDescriptions[key]).map(([key]) => capabilityDescriptions[key]),
    compatibility,
    last_seen_age_ms: Number.isFinite(lastSeen) ? Math.max(0, Date.now() - lastSeen) : null
  };
}

export async function linkPeer(url, priority = config.node.workerBasePriority) {
  if (!config.node.clusterSecret) throw new Error("CLUSTER_SHARED_SECRET is required before linking deployments.");
  const clean = normalizePeerUrl(url);
  const normalizedPriority = normalizePeerPriority(priority);
  let response;
  try {
    response = await fetch(`${clean}/internal/node-info`, { headers: clusterHeaders(), signal: AbortSignal.timeout(5000) });
  } catch (error) {
    const reason = error?.name === "TimeoutError" || error?.name === "AbortError" ? "The deployment did not respond in time." : "Check the address and network connection.";
    throw new Error(`Could not reach that deployment. ${reason}`);
  }
  if (!response.ok) {
    const hint = [401, 403].includes(response.status) ? "Check that both deployments use the same cluster secret." : "Check that the deployment is running and reachable.";
    throw new Error(`Could not connect to that deployment (${response.status}). ${hint}`);
  }
  let info;
  try { info = await response.json(); } catch { throw new Error("Peer handshake returned invalid deployment information."); }
  if (!info || typeof info !== "object" || typeof info.nodeId !== "string" || !info.nodeId.trim()) throw new Error("Peer handshake did not identify the deployment.");
  const remoteNodeId = info.nodeId.trim();
  if (remoteNodeId === nodeId) throw new Error("Cannot link this deployment to itself.");
  if (peers().some((peer) => peer.url === clean && peer.node_id !== remoteNodeId)) throw new Error("That address is already linked to another deployment.");
  upsertPeer({
    node_id: remoteNodeId,
    name: typeof info.name === "string" && info.name.trim() ? info.name.trim() : remoteNodeId,
    url: clean,
    role: typeof info.role === "string" && info.role.trim() ? info.role.trim() : "worker",
    capabilities_json: JSON.stringify(info.capabilities && typeof info.capabilities === "object" ? info.capabilities : {}),
    embedding_fingerprint: typeof info.embedding?.fingerprint === "string" ? info.embedding.fingerprint : "",
    reranker_fingerprint: typeof info.reranker?.fingerprint === "string" ? info.reranker.fingerprint : "",
    load: finiteNonNegative(info.load),
    active_jobs: finiteNonNegative(info.activeJobs),
    priority: normalizedPriority,
    status: "healthy",
    last_seen: nowIso(),
    created_at: nowIso()
  });
  return info;
}

export function peers() {
  return listPeers().map(describePeer);
}
export function unlinkPeer(id) { removePeerDb(id); }

function isPeerHealthy(peer) {
  if (peer.status !== "healthy" || !peer.last_seen) return false;
  return Date.now() - Date.parse(peer.last_seen) <= config.node.heartbeatTtlMs * 2;
}

function choosePeer(kind) {
  const candidates = peers().filter((p) => isPeerHealthy(p) && p.capabilities?.[kind]);
  if (kind === "embed") candidates.splice(0, candidates.length, ...candidates.filter((p) => p.embedding_fingerprint === embeddingFingerprint));
  if (kind === "rerank") candidates.splice(0, candidates.length, ...candidates.filter((p) => p.reranker_fingerprint === rerankerFingerprint));
  const score = (peer) => finiteNonNegative(peer.priority) + finiteNonNegative(peer.load) * 100 + finiteNonNegative(peer.active_jobs) * 25;
  candidates.sort((a, b) => score(a) - score(b));
  const best = candidates[0];
  const localScore = finiteNonNegative(config.node.gatewayComputePenalty) + localLoad() * 100 + activeJobs * 25;
  return best && score(best) < localScore ? best : null;
}

async function callPeer(peer, path, body) {
  const response = await fetch(`${peer.url}${path}`, { method: "POST", headers: clusterHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Peer ${peer.name} failed (${response.status}): ${responseText.slice(0, 500)}`);
  try { return responseText ? JSON.parse(responseText) : {}; } catch { throw new Error(`Peer ${peer.name} returned invalid JSON.`); }
}

function shouldDistribute() { return ["gateway", "hybrid"].includes(config.node.role) && peers().length > 0; }

export async function computeEmbed(inputs, { forceLocal = false } = {}) {
  const rawInputs = Array.isArray(inputs) ? inputs : [inputs];
  const normalizedInputs = rawInputs.map((input) => String(input ?? "").trim());
  if (!normalizedInputs.length || normalizedInputs.some((input) => !input)) throw new Error("At least one non-empty text input is required for embedding.");
  if (!forceLocal && shouldDistribute()) {
    const peer = choosePeer("embed");
    if (peer) {
      try {
        const result = await callPeer(peer, "/internal/compute/embed", { inputs: normalizedInputs });
        if (!Array.isArray(result.vectors) || result.vectors.length !== normalizedInputs.length || result.vectors.some((vector) => !Array.isArray(vector) || !vector.length || vector.some((value) => typeof value !== "number" || !Number.isFinite(value)))) throw new Error("Peer returned invalid embeddings.");
        return result.vectors;
      } catch (error) {
        setPeerHealth(peer.node_id, { status: "degraded", load: peer.load, activeJobs: peer.active_jobs, lastSeen: peer.last_seen });
        console.warn(error.message);
      }
    }
  }
  activeJobs++;
  try { return await embedLocal(normalizedInputs); } finally { activeJobs--; }
}

export async function computeRerank(query, documents, options = {}, { forceLocal = false } = {}) {
  const normalizedQuery = String(query ?? "").trim();
  const normalizedDocuments = (Array.isArray(documents) ? documents : []).map((document) => typeof document === "string" ? document : String(document?.text ?? document?.document?.text ?? ""));
  if (!normalizedQuery) throw new Error("query is required for reranking.");
  if (!forceLocal && shouldDistribute()) {
    const peer = choosePeer("rerank");
    if (peer) {
      try {
        const result = await callPeer(peer, "/internal/compute/rerank", { query: normalizedQuery, documents: normalizedDocuments, options });
        if (!result.result || !Array.isArray(result.result.results) || result.result.results.some((item) => !Number.isInteger(item?.index) || item.index < 0 || item.index >= normalizedDocuments.length || !Number.isFinite(Number(item.relevance_score)))) throw new Error("Peer returned an invalid reranking result.");
        return result.result;
      } catch (error) {
        setPeerHealth(peer.node_id, { status: "degraded", load: peer.load, activeJobs: peer.active_jobs, lastSeen: peer.last_seen });
        console.warn(error.message);
      }
    }
  }
  activeJobs++;
  try { return await rerankLocal(normalizedQuery, normalizedDocuments, options); } finally { activeJobs--; }
}

export async function heartbeatPeers() {
  if (heartbeatPromise) return heartbeatPromise;
  heartbeatPromise = Promise.allSettled(peers().map(async (peer) => {
    try {
      const response = await fetch(`${peer.url}/internal/node-info`, { headers: clusterHeaders(), signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw new Error(String(response.status));
      const info = await response.json();
      if (typeof info?.nodeId !== "string" || info.nodeId !== peer.node_id) throw new Error("identity mismatch");
      setPeerHealth(peer.node_id, { load: finiteNonNegative(info.load), activeJobs: finiteNonNegative(info.activeJobs), status: "healthy", embeddingFingerprint: typeof info.embedding?.fingerprint === "string" ? info.embedding.fingerprint : null, rerankerFingerprint: typeof info.reranker?.fingerprint === "string" ? info.reranker.fingerprint : null });
    } catch { setPeerHealth(peer.node_id, { status: "offline", load: peer.load, activeJobs: peer.active_jobs, lastSeen: peer.last_seen }); }
  })).finally(() => { heartbeatPromise = null; });
  return heartbeatPromise;
}

async function deliverReplication(peer, event) {
  if (!isPeerHealthy(peer)) {
    queueReplication(peer.node_id, event, "Peer is not currently reachable.");
    return false;
  }
  try {
    await callPeer(peer, "/internal/replicate", event);
    ackReplication(peer.node_id, event.opId);
    setPeerHealth(peer.node_id, { status: "healthy", load: peer.load, activeJobs: peer.active_jobs });
    return true;
  } catch (error) {
    setPeerHealth(peer.node_id, { status: "degraded", load: peer.load, activeJobs: peer.active_jobs, lastSeen: peer.last_seen });
    queueReplication(peer.node_id, event, error.message);
    return false;
  }
}

export async function replicateToPeer(peerNodeId, event) {
  const peer = peers().find((p) => p.node_id === peerNodeId);
  if (!peer) throw new Error("Peer not found.");
  if (!peer.capabilities?.storage) throw new Error("Peer is not storage-capable.");
  return deliverReplication(peer, event);
}

export async function broadcastReplication(event, excludeNodeId = null) {
  const targets = peers().filter((p) => p.node_id !== excludeNodeId && p.capabilities?.storage);
  await Promise.allSettled(targets.map((peer) => deliverReplication(peer, event)));
}

export async function processReplicationOutbox() {
  if (replicationPromise) return replicationPromise;
  replicationPromise = (async () => {
    for (const item of dueReplication()) {
      const peer = peers().find((p) => p.node_id === item.peer_node_id);
      if (!peer) { ackReplication(item.peer_node_id, item.op_id); continue; }
      if (!isPeerHealthy(peer)) {
        failReplication(item.peer_node_id, item.op_id, "Peer is not currently reachable.", item.attempts);
        continue;
      }
      try {
        await callPeer(peer, "/internal/replicate", JSON.parse(item.payload_json));
        ackReplication(item.peer_node_id, item.op_id);
        setPeerHealth(peer.node_id, { status: "healthy", load: peer.load, activeJobs: peer.active_jobs });
      } catch (error) {
        setPeerHealth(peer.node_id, { status: "degraded", load: peer.load, activeJobs: peer.active_jobs, lastSeen: peer.last_seen });
        failReplication(item.peer_node_id, item.op_id, error.message, item.attempts);
      }
    }
  })().finally(() => { replicationPromise = null; });
  return replicationPromise;
}

export async function publishToGateway(event) {
  if (!config.node.gatewayUrl || ["gateway", "hybrid", "standalone"].includes(config.node.role)) return false;
  const response = await fetch(`${config.node.gatewayUrl}/internal/replicate`, { method: "POST", headers: clusterHeaders(), body: JSON.stringify({ ...event, propagate: true }), signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Gateway replication failed (${response.status}).`);
  return true;
}
