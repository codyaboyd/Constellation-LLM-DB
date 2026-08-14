function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function metadata(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...value };
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {}
  }
  return {};
}

export function documentFrom(value) {
  const raw = asObject(value);
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    sourceType: String(raw.sourceType ?? raw.source_type ?? ""),
    sourceUri: String(raw.sourceUri ?? raw.source_uri ?? ""),
    sha256: raw.sha256 ?? null,
    chunkCount: asInteger(raw.chunkCount ?? raw.chunk_count),
    status: raw.status ?? null,
    originNode: raw.originNode ?? raw.origin_node ?? null,
    metadata: metadata(raw.metadata ?? raw.metadata_json),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    deletedAt: raw.deletedAt ?? raw.deleted_at ?? null,
    raw
  };
}

export function queryResultFrom(value) {
  const raw = asObject(value);
  return {
    id: String(raw.id ?? ""),
    documentId: String(raw.documentId ?? raw.document_id ?? ""),
    chunkIndex: asInteger(raw.chunkIndex ?? raw.chunk_index),
    text: String(raw.text ?? ""),
    title: String(raw.title ?? ""),
    sourceType: String(raw.sourceType ?? raw.source_type ?? ""),
    sourceUri: String(raw.sourceUri ?? raw.source_uri ?? ""),
    metadata: metadata(raw.metadata ?? raw.metadata_json),
    vectorScore: asNumber(raw.vectorScore ?? raw.vector_score),
    rerankScore: asNumber(raw.rerankScore ?? raw.rerank_score),
    originalRank: raw.originalRank === undefined && raw.original_rank === undefined ? null : asInteger(raw.originalRank ?? raw.original_rank),
    distance: asNumber(raw.distance ?? raw._distance),
    raw
  };
}

export function queryResponseFrom(value) {
  const raw = asObject(value);
  return {
    query: String(raw.query ?? ""),
    results: Array.isArray(raw.results) ? raw.results.map(queryResultFrom) : []
  };
}

export function embeddingResponseFrom(value) {
  const raw = asObject(value);
  return {
    model: asObject(raw.model),
    vectors: Array.isArray(raw.vectors) ? raw.vectors.map((vector) => Array.isArray(vector) ? vector.map(Number) : []) : []
  };
}

export function rerankResultFrom(value) {
  const raw = asObject(value);
  return {
    index: asInteger(raw.index),
    relevanceScore: asNumber(raw.relevanceScore ?? raw.relevance_score) ?? 0,
    document: raw.document && typeof raw.document === "object" ? raw.document : null,
    raw
  };
}

export function rerankResponseFrom(value) {
  const raw = asObject(value);
  return {
    model: raw.model ?? null,
    local: raw.local ?? null,
    results: Array.isArray(raw.results) ? raw.results.map(rerankResultFrom) : []
  };
}

export function ingestResultFrom(value) {
  const raw = asObject(value);
  return {
    document: documentFrom(raw.document),
    chunks: asInteger(raw.chunks),
    replicatedViaGateway: Boolean(raw.replicatedViaGateway ?? raw.replicated_via_gateway),
    raw
  };
}

export function crawlResponseFrom(value) {
  const raw = asObject(value);
  return {
    pages: asInteger(raw.pages),
    results: Array.isArray(raw.results) ? raw.results.map(ingestResultFrom) : [],
    raw
  };
}

export function chunkFrom(value) {
  const raw = asObject(value);
  return {
    id: String(raw.id ?? ""),
    documentId: String(raw.documentId ?? raw.document_id ?? ""),
    chunkIndex: asInteger(raw.chunkIndex ?? raw.chunk_index),
    text: String(raw.text ?? ""),
    raw
  };
}

export function documentChunksFrom(value) {
  const raw = asObject(value);
  return {
    document: asObject(raw.document),
    chunks: Array.isArray(raw.chunks) ? raw.chunks.map(chunkFrom) : [],
    raw
  };
}

export function documentTextFrom(value) {
  const raw = asObject(value);
  return {
    document: documentFrom(raw.document),
    text: String(raw.text ?? ""),
    raw
  };
}

export function peerFrom(value) {
  const raw = asObject(value);
  return {
    nodeId: String(raw.nodeId ?? raw.node_id ?? ""),
    url: String(raw.url ?? ""),
    name: raw.name ?? null,
    reachable: raw.reachable ?? null,
    status: raw.status ?? null,
    role: raw.role ?? null,
    priority: raw.priority === null || raw.priority === undefined ? null : asInteger(raw.priority),
    capabilities: asObject(raw.capabilities),
    raw
  };
}
