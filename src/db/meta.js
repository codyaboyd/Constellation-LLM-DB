import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config, initializeManagedSettings } from "../config.js";
import { nowIso, uuid } from "../util.js";

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new Database(path.join(config.dataDir, "constellation.sqlite"), { create: true });
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_uri TEXT,
  sha256 TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  origin_node TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS peers (
  node_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  embedding_fingerprint TEXT,
  reranker_fingerprint TEXT,
  load REAL NOT NULL DEFAULT 0,
  active_jobs INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS replication_events (
  op_id TEXT PRIMARY KEY,
  origin_node TEXT NOT NULL,
  op_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT
);
CREATE TABLE IF NOT EXISTS replication_outbox (
  peer_node_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(peer_node_id, op_id)
);
`);
const peerColumns = new Set(db.query("PRAGMA table_info(peers)").all().map((row) => row.name));
if (!peerColumns.has("reranker_fingerprint")) db.exec("ALTER TABLE peers ADD COLUMN reranker_fingerprint TEXT");

export function getSetting(key) { return db.query("SELECT value FROM settings WHERE key=?").get(key)?.value ?? null; }
export function setSetting(key, value) { db.query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value)); }
export function ensureNodeId() { let id = getSetting("node_id"); if (!id) { id = uuid(); setSetting("node_id", id); } return id; }

export function upsertDocument(doc) {
  const row = { ...(doc || {}) };
  row.title = String(row.title ?? "").trim() || String(row.source_uri ?? "").trim() || "Untitled document";
  row.source_type = String(row.source_type ?? "").trim() || "unknown";
  row.metadata_json = typeof row.metadata_json === "string" ? row.metadata_json : "{}";
  db.query(`INSERT INTO documents(id,title,source_type,source_uri,sha256,chunk_count,status,origin_node,metadata_json,created_at,updated_at,deleted_at)
    VALUES($id,$title,$source_type,$source_uri,$sha256,$chunk_count,$status,$origin_node,$metadata_json,$created_at,$updated_at,$deleted_at)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,source_type=excluded.source_type,source_uri=excluded.source_uri,sha256=excluded.sha256,chunk_count=excluded.chunk_count,status=excluded.status,origin_node=excluded.origin_node,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`).run({
      $id: row.id,
      $title: row.title,
      $source_type: row.source_type,
      $source_uri: row.source_uri,
      $sha256: row.sha256,
      $chunk_count: row.chunk_count,
      $status: row.status,
      $origin_node: row.origin_node,
      $metadata_json: row.metadata_json,
      $created_at: row.created_at,
      $updated_at: row.updated_at,
      $deleted_at: row.deleted_at
    });
}
export function listDocuments() { return db.query("SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC").all(); }
export function getDocument(id) { return db.query("SELECT * FROM documents WHERE id=?").get(id); }
export function listDocumentsByTitle(title) {
  return db.query("SELECT * FROM documents WHERE title=? AND deleted_at IS NULL ORDER BY created_at DESC").all(title);
}
export function markDocumentDeleted(id) { db.query("UPDATE documents SET deleted_at=?, updated_at=? WHERE id=?").run(nowIso(), nowIso(), id); }

export function upsertPeer(peer) {
  db.query(`INSERT INTO peers(node_id,name,url,role,capabilities_json,embedding_fingerprint,reranker_fingerprint,load,active_jobs,priority,status,last_seen,created_at)
    VALUES($node_id,$name,$url,$role,$capabilities_json,$embedding_fingerprint,$reranker_fingerprint,$load,$active_jobs,$priority,$status,$last_seen,$created_at)
    ON CONFLICT(node_id) DO UPDATE SET name=excluded.name,url=excluded.url,role=excluded.role,capabilities_json=excluded.capabilities_json,embedding_fingerprint=excluded.embedding_fingerprint,reranker_fingerprint=excluded.reranker_fingerprint,load=excluded.load,active_jobs=excluded.active_jobs,priority=excluded.priority,status=excluded.status,last_seen=excluded.last_seen`).run({
      $node_id: peer.node_id,
      $name: peer.name,
      $url: peer.url,
      $role: peer.role,
      $capabilities_json: peer.capabilities_json,
      $embedding_fingerprint: peer.embedding_fingerprint,
      $reranker_fingerprint: peer.reranker_fingerprint,
      $load: peer.load,
      $active_jobs: peer.active_jobs,
      $priority: peer.priority,
      $status: peer.status,
      $last_seen: peer.last_seen,
      $created_at: peer.created_at
    });
}
export function listPeers() { return db.query("SELECT * FROM peers ORDER BY name").all(); }
export function removePeer(nodeId) { db.query("DELETE FROM peers WHERE node_id=?").run(nodeId); }
export function setPeerHealth(nodeId, { load = 0, activeJobs = 0, status = "healthy", lastSeen = nowIso(), embeddingFingerprint = null, rerankerFingerprint = null }) {
  db.query("UPDATE peers SET load=?,active_jobs=?,status=?,last_seen=?,embedding_fingerprint=COALESCE(?,embedding_fingerprint),reranker_fingerprint=COALESCE(?,reranker_fingerprint) WHERE node_id=?")
    .run(load, activeJobs, status, lastSeen, embeddingFingerprint, rerankerFingerprint, nodeId);
}
export function recordReplicationEvent(event) {
  const result = db.query("INSERT OR IGNORE INTO replication_events(op_id,origin_node,op_type,payload_json,created_at,applied_at) VALUES(?,?,?,?,?,?)")
    .run(event.opId, event.originNode, event.type, JSON.stringify(event.payload), event.createdAt || nowIso(), nowIso());
  return result.changes > 0;
}
export function hasReplicationEvent(opId) { return !!db.query("SELECT 1 FROM replication_events WHERE op_id=?").get(opId); }
export function queueReplication(peerNodeId, event, error = "") {
  const now = nowIso();
  db.query(`INSERT INTO replication_outbox(peer_node_id,op_id,payload_json,attempts,next_attempt_at,last_error,created_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(peer_node_id,op_id) DO UPDATE SET payload_json=excluded.payload_json,last_error=excluded.last_error`)
    .run(peerNodeId, event.opId, JSON.stringify(event), 0, now, String(error || ""), now);
}
export function dueReplication(limit = 50) { return db.query("SELECT * FROM replication_outbox WHERE next_attempt_at <= ? ORDER BY created_at LIMIT ?").all(nowIso(), limit); }
export function ackReplication(peerNodeId, opId) { db.query("DELETE FROM replication_outbox WHERE peer_node_id=? AND op_id=?").run(peerNodeId, opId); }
export function failReplication(peerNodeId, opId, error, attempts) {
  const delayMs = Math.min(300000, Math.max(5000, 5000 * 2 ** Math.min(Number(attempts) || 0, 6)));
  db.query("UPDATE replication_outbox SET attempts=attempts+1,next_attempt_at=?,last_error=? WHERE peer_node_id=? AND op_id=?")
    .run(new Date(Date.now() + delayMs).toISOString(), String(error || ""), peerNodeId, opId);
}
export function outboxCount() { return db.query("SELECT COUNT(*) AS n FROM replication_outbox").get()?.n || 0; }
export { db };

initializeManagedSettings(getSetting, setSetting);
