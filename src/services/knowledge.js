import { chunkText } from "./chunk.js";
import { computeEmbed, computeRerank, nodeId, broadcastReplication, publishToGateway } from "./cluster.js";
import { deleteDocumentChunks, getDocumentChunkText, getDocumentChunks, retrieveVector, upsertChunks } from "./lance.js";
import { getDocument, hasReplicationEvent, listDocuments, listDocumentsByTitle, markDocumentDeleted, recordReplicationEvent, upsertDocument } from "../db/meta.js";
import { nowIso, sha256, uuid } from "../util.js";
import { config } from "../config.js";

function docRow({ id, title, sourceType, sourceUri = "", sha, chunkCount, metadata = {}, originNode = nodeId, createdAt = nowIso(), deletedAt = null }) {
  const now = nowIso();
  return {
    id, title, source_type: sourceType, source_uri: sourceUri, sha256: sha, chunk_count: chunkCount,
    status: "ready", origin_node: originNode, metadata_json: JSON.stringify(metadata),
    created_at: createdAt, updated_at: now, deleted_at: deletedAt
  };
}

export async function ingestText({ title, text, sourceType = "manual", sourceUri = "", metadata = {}, chunkSize = 1200, overlap = 180, documentId = uuid(), createdAt = nowIso(), replicate = true }) {
  const inputText = String(text ?? "");
  if (!inputText.trim()) throw new Error("No text was extracted.");
  const normalizedSourceUri = String(sourceUri ?? "").trim();
  const normalizedTitle = String(title ?? "").trim() || normalizedSourceUri || "Untitled document";
  const normalizedSourceType = String(sourceType ?? "").trim() || "unknown";
  const normalizedMetadata = metadata && typeof metadata === "object" ? metadata : {};
  const chunks = chunkText(inputText, { chunkSize, overlap });
  const vectors = await computeEmbed(chunks);
  if (vectors.length !== chunks.length) throw new Error("Embedding count mismatch.");
  const rows = chunks.map((chunk, i) => ({
    id: `${documentId}:${i}`,
    document_id: documentId,
    chunk_index: i,
    text: chunk,
    vector: vectors[i],
    title: normalizedTitle,
    source_type: normalizedSourceType,
    source_uri: normalizedSourceUri,
    metadata_json: JSON.stringify(normalizedMetadata),
    content_hash: sha256(chunk),
    origin_node: nodeId,
    created_at: createdAt
  }));
  await upsertChunks(rows);
  const doc = docRow({ id: documentId, title: normalizedTitle, sourceType: normalizedSourceType, sourceUri: normalizedSourceUri, sha: sha256(inputText), chunkCount: chunks.length, metadata: normalizedMetadata, createdAt });
  upsertDocument(doc);
  if (replicate) {
    const event = { opId: uuid(), originNode: nodeId, type: "upsert_document", payload: { document: doc, chunks: rows }, createdAt };
    recordReplicationEvent(event);
    if (await publishToGateway(event)) return { document: doc, chunks: chunks.length, replicatedViaGateway: true };
    await broadcastReplication(event);
  }
  return { document: doc, chunks: chunks.length };
}

export async function deleteKnowledge(id, { replicate = true } = {}) {
  const doc = resolveDocument(id);
  await deleteDocumentChunks(doc.id);
  markDocumentDeleted(doc.id);
  if (replicate) {
    const event = { opId: uuid(), originNode: nodeId, type: "delete_document", payload: { documentId: doc.id }, createdAt: nowIso() };
    recordReplicationEvent(event);
    if (await publishToGateway(event)) return { deleted: true, replicatedViaGateway: true };
    await broadcastReplication(event);
  }
  return { deleted: true };
}

function documentNotFound() {
  const error = new Error("Document not found.");
  error.status = 404;
  return error;
}

function documentTitleConflict() {
  const error = new Error("More than one document has this title; use its ID instead.");
  error.status = 409;
  return error;
}

function resolveDocument(reference) {
  const value = String(reference ?? "").trim();
  if (!value) throw documentNotFound();
  const byId = getDocument(value);
  if (byId && !byId.deleted_at) return byId;
  const byTitle = listDocumentsByTitle(value);
  if (byTitle.length > 1) throw documentTitleConflict();
  if (byTitle[0]) return byTitle[0];
  throw documentNotFound();
}

function metadataFromDocument(document) {
  try {
    const parsed = JSON.parse(document.metadata_json || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function plainTextFromChunks(chunks) {
  let text = "";
  for (const chunk of chunks) {
    const next = String(chunk.text ?? "");
    if (!next) continue;
    if (!text) {
      text = next;
      continue;
    }

    // Long paragraphs are chunked with overlap. Remove the duplicated suffix
    // when reconstructing the document, while preserving paragraph breaks.
    const maxOverlap = Math.min(text.length, next.length);
    let overlap = 0;
    for (let size = maxOverlap; size >= 20; size--) {
      if (text.endsWith(next.slice(0, size))) {
        overlap = size;
        break;
      }
    }
    text += overlap ? next.slice(overlap) : `\n\n${next}`;
  }
  return text;
}

export async function knowledgeText(reference) {
  const document = resolveDocument(reference);
  const chunks = await getDocumentChunkText(document.id);
  chunks.sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index));
  return { document, text: plainTextFromChunks(chunks) };
}

export async function replaceKnowledge(reference, {
  text,
  title,
  sourceType,
  sourceUri,
  metadata,
  chunkSize = 1200,
  overlap = 180,
  replicate = true
} = {}) {
  const document = resolveDocument(reference);
  return ingestText({
    title: title === undefined ? document.title : title,
    text,
    sourceType: sourceType === undefined ? document.source_type : sourceType,
    sourceUri: sourceUri === undefined ? document.source_uri : sourceUri,
    metadata: metadata === undefined ? metadataFromDocument(document) : metadata,
    chunkSize,
    overlap,
    documentId: document.id,
    createdAt: document.created_at,
    replicate
  });
}

export async function applyReplication(event) {
  if (!event?.opId || !event?.type) throw new Error("Invalid replication event.");
  if (hasReplicationEvent(event.opId)) return { duplicate: true };
  if (event.type === "upsert_document") {
    const { document, chunks } = event.payload || {};
    if (!document || !Array.isArray(chunks)) throw new Error("Invalid upsert replication payload.");
    await upsertChunks(chunks);
    upsertDocument(document);
  } else if (event.type === "delete_document") {
    await deleteDocumentChunks(event.payload.documentId);
    if (getDocument(event.payload.documentId)) markDocumentDeleted(event.payload.documentId);
  } else throw new Error(`Unsupported replication event: ${event.type}`);
  recordReplicationEvent(event);
  if (event.propagate && ["gateway", "hybrid"].includes(config.node.role)) await broadcastReplication(event, event.originNode);
  return { applied: true };
}

export async function queryKnowledge({
  query,
  topK = 5,
  candidateK = 20,
  rerank = true,
  rerankTopK = null,
  minScore = null,
  filter = "",
  nprobes = null,
  refineFactor = null,
  distanceType = "cosine"
}) {
  if (!query?.trim()) throw new Error("query is required");
  const [vector] = await computeEmbed([query]);
  let results = await retrieveVector(vector, { candidateK, filter, nprobes, refineFactor, distanceType });
  results = results.map((r) => ({ ...r, vector_score: distanceType === "cosine" ? 1 - Number(r._distance ?? 0) : null }));
  if (minScore != null && distanceType === "cosine") results = results.filter((r) => r.vector_score >= Number(minScore));
  const finalTopK = Math.max(1, Math.min(Number(topK) || 5, 100));
  if (rerank && results.length) {
    const topN = Math.min(Number(rerankTopK) || finalTopK, results.length);
    const ranked = await computeRerank(query, results.map((r) => r.text), { topN, returnDocuments: false });
    const mapped = (ranked.results || []).map((item) => ({
      ...results[item.index],
      rerank_score: item.relevance_score,
      original_rank: item.index + 1
    }));
    return mapped.slice(0, finalTopK);
  }
  return results.slice(0, finalTopK);
}

export async function buildDocumentReplicationEvent(documentId) {
  const document = getDocument(documentId);
  if (!document || document.deleted_at) throw new Error("Document not found.");
  const chunks = await getDocumentChunks(documentId);
  return { opId: uuid(), originNode: nodeId, type: "upsert_document", payload: { document, chunks }, createdAt: nowIso() };
}

export function knowledgeList() { return listDocuments(); }

export async function knowledgeChunks(documentId) {
  const document = resolveDocument(documentId);
  const chunks = await getDocumentChunkText(document.id);
  chunks.sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index));
  return {
    document: { id: document.id, title: document.title, chunk_count: document.chunk_count },
    chunks: chunks.map(({ id, document_id, chunk_index, text }) => ({ id, document_id, chunk_index, text }))
  };
}
