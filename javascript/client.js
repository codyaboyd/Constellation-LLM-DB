import {
  AuthenticationError,
  ConstellationAPIError,
  ConstellationConnectionError,
  ConstellationTimeoutError,
  NotFoundError
} from "./errors.js";
import {
  crawlResponseFrom,
  documentChunksFrom,
  documentFrom,
  documentTextFrom,
  embeddingResponseFrom,
  ingestResultFrom,
  peerFrom,
  queryResponseFrom,
  rerankResponseFrom
} from "./models.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:4317";

function requireText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${name} must not be empty`);
  return text;
}

function optional(payload, key, value) {
  if (value !== undefined && value !== null) payload[key] = value;
}

function encodePath(value) {
  return encodeURIComponent(requireText(value, "value"));
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(details) {
  if (isPlainObject(details)) return String(details.error ?? details.message ?? "Request failed");
  return details == null || details === "" ? "Request failed" : String(details);
}

function errorForResponse(status, message, options) {
  if (status === 401 || status === 403) return new AuthenticationError(status, message, options);
  if (status === 404) return new NotFoundError(status, message, options);
  return new ConstellationAPIError(status, message, options);
}

function canUseFormData() {
  return typeof FormData !== "undefined";
}

function hasBuffer() {
  return typeof Buffer !== "undefined";
}

function isBlob(value) {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

async function fileNameFor(file, fallback) {
  if (typeof file === "string" || file instanceof URL) {
    const value = String(file);
    return value.split(/[\\/]/).pop() || fallback;
  }
  return file?.name || fallback;
}

async function uploadValue(file) {
  if (isBlob(file)) return file;
  if (hasBuffer() && Buffer.isBuffer(file)) return new Blob([file]);
  if (file instanceof Uint8Array) return new Blob([file]);
  if (typeof file === "string" || file instanceof URL) {
    if (typeof Bun !== "undefined" && typeof Bun.file === "function") return Bun.file(String(file));
    if (typeof process !== "undefined" && process.versions?.node) {
      const { readFile } = await import("node:fs/promises");
      return new Blob([await readFile(String(file))]);
    }
    throw new TypeError("File paths are supported in Node.js and Bun only");
  }
  if (file && typeof file.arrayBuffer === "function") return new Blob([await file.arrayBuffer()]);
  throw new TypeError("file must be a Blob, Buffer, Uint8Array, path, or file-like object");
}

/**
 * Async client for a Constellation deployment.
 *
 * The client only depends on the platform fetch API and works in modern
 * browsers, Node.js 18+, Bun, Deno, and serverless runtimes.
 */
export class ConstellationClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, apiKey, timeout = 30_000, fetch: fetchImpl, userAgent = "constellation-js/0.1.0" } = {}) {
    let parsed;
    try { parsed = new URL(String(baseUrl)); } catch { parsed = null; }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol) || !parsed.host) {
      throw new TypeError("baseUrl must be an absolute HTTP(S) URL");
    }
    if (!Number.isFinite(Number(timeout)) || Number(timeout) <= 0) throw new TypeError("timeout must be greater than zero");
    if (fetchImpl !== undefined && typeof fetchImpl !== "function") throw new TypeError("fetch must be a function");
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeout = Number(timeout);
    this.fetch = fetchImpl || globalThis.fetch;
    this.userAgent = userAgent;
    if (typeof this.fetch !== "function") throw new TypeError("A fetch implementation is required");
  }

  static fromEnv(options = {}) {
    const env = typeof process !== "undefined" ? process.env || {} : {};
    return new this({
      ...options,
      baseUrl: options.baseUrl ?? env.CONSTELLATION_URL ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey ?? env.CONSTELLATION_API_KEY
    });
  }

  async request(method, path, { body, headers = {}, authenticated = true, signal } = {}) {
    const url = `${this.baseUrl}/${String(path).replace(/^\/+/, "")}`;
    const requestHeaders = new Headers({ Accept: "application/json", "User-Agent": this.userAgent, ...headers });
    if (authenticated && this.apiKey) requestHeaders.set("Authorization", `Bearer ${this.apiKey}`);
    let requestBody = body;
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    if (body !== undefined && body !== null && !isFormData && !requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json; charset=utf-8");
      requestBody = JSON.stringify(body);
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), this.timeout);
    const onAbort = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    let response;
    try {
      response = await this.fetch(url, { method: method.toUpperCase(), headers: requestHeaders, body: requestBody, signal: controller.signal });
    } catch (error) {
      if (signal) signal.removeEventListener("abort", onAbort);
      clearTimeout(timeoutId);
      if (error?.name === "TimeoutError" || error?.name === "AbortError" && controller.signal.reason?.name === "TimeoutError") {
        throw new ConstellationTimeoutError(`Timed out calling ${method.toUpperCase()} ${url}`, { cause: error });
      }
      throw new ConstellationConnectionError(`Could not connect to ${url}: ${error?.message || error}`, { cause: error });
    }
    if (signal) signal.removeEventListener("abort", onAbort);
    clearTimeout(timeoutId);
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (!response.ok) {
      throw errorForResponse(response.status, errorMessage(payload), { method, url, details: payload });
    }
    return payload;
  }

  jsonRequest(method, path, payload, options = {}) {
    return this.request(method, path, { ...options, body: payload });
  }

  health(options) { return this.request("GET", "/health", { ...options, authenticated: false }); }
  status(options) { return this.request("GET", "/api/status", options); }
  models(options) { return this.request("GET", "/api/models", options); }
  settings(options) { return this.request("GET", "/api/settings", options); }
  getSettings(options) { return this.settings(options); }

  updateSettings(settings, { clearSecrets = [], ...options } = {}) {
    return this.jsonRequest("PUT", "/api/settings", { settings, clearSecrets }, options);
  }

  preloadModels(options) { return this.jsonRequest("POST", "/api/models/preload", {}, options); }

  async query(query, {
    topK = 5,
    candidateK = 20,
    rerank = true,
    rerankTopK,
    minScore,
    filter,
    nprobes,
    refineFactor,
    distanceType = "cosine",
    table,
    tableName,
    ...options
  } = {}) {
    const payload = { query: requireText(query, "query"), topK, candidateK, rerank, distanceType };
    optional(payload, tableName !== undefined && tableName !== null ? "tableName" : "table", tableName ?? table);
    optional(payload, "rerankTopK", rerankTopK);
    optional(payload, "minScore", minScore);
    optional(payload, "filter", filter);
    optional(payload, "nprobes", nprobes);
    optional(payload, "refineFactor", refineFactor);
    return queryResponseFrom(await this.jsonRequest("POST", "/api/query", payload, options));
  }

  search(query, options) { return this.query(query, options); }

  async createEmbeddings(inputs, options) {
    const values = typeof inputs === "string" ? [inputs] : Array.from(inputs || []);
    if (!values.length || values.some((value) => !String(value ?? "").trim())) throw new TypeError("inputs must contain at least one non-empty text value");
    return embeddingResponseFrom(await this.jsonRequest("POST", "/api/embeddings", { inputs: values }, options));
  }

  embeddings(inputs, options) { return this.createEmbeddings(inputs, options); }

  async embed(inputs, options) {
    const response = await this.createEmbeddings(inputs, options);
    return typeof inputs === "string" ? response.vectors[0] : response.vectors;
  }

  async rerank(query, documents, { topN, returnDocuments = true, ...options } = {}) {
    if (!Array.isArray(documents) || !documents.length) throw new TypeError("documents must contain at least one item");
    const payload = { query: requireText(query, "query"), documents, returnDocuments };
    optional(payload, "topN", topN);
    return rerankResponseFrom(await this.jsonRequest("POST", "/api/rerank", payload, options));
  }

  async listDocuments(options) {
    const response = await this.request("GET", "/api/knowledge", options) || {};
    return Array.isArray(response.documents) ? response.documents.map(documentFrom) : [];
  }

  documents(options) { return this.listDocuments(options); }

  async listTables(options) {
    const response = await this.request("GET", "/api/tables", options) || {};
    return Array.isArray(response.tables) ? response.tables.map(String) : [];
  }

  tables(options) { return this.listTables(options); }

  async ingestText(title, text, { metadata = {}, chunkSize, overlap, table, tableName, ...options } = {}) {
    const payload = { title: requireText(title, "title"), text: requireText(text, "text"), metadata };
    optional(payload, "chunkSize", chunkSize);
    optional(payload, "overlap", overlap);
    optional(payload, tableName !== undefined && tableName !== null ? "tableName" : "table", tableName ?? table);
    return ingestResultFrom(await this.jsonRequest("POST", "/api/knowledge/manual", payload, options));
  }

  async uploadFile(file, { filename, title, chunkSize, overlap, table, tableName, ...options } = {}) {
    if (!canUseFormData()) throw new TypeError("This runtime does not provide FormData");
    const value = await uploadValue(file);
    const form = new FormData();
    if (title !== undefined) form.set("title", String(title));
    if (chunkSize !== undefined) form.set("chunkSize", String(chunkSize));
    if (overlap !== undefined) form.set("overlap", String(overlap));
    if (tableName !== undefined) form.set("tableName", String(tableName));
    else if (table !== undefined) form.set("table", String(table));
    const name = filename || await fileNameFor(file, "document.txt");
    form.set("file", value, name);
    return ingestResultFrom(await this.request("POST", "/api/knowledge/upload", { ...options, body: form }));
  }

  async crawl(url, { maxPages, maxDepth, sameOrigin = true, chunkSize, overlap, table, tableName, ...options } = {}) {
    const payload = { url: requireText(url, "url"), sameOrigin };
    optional(payload, "maxPages", maxPages);
    optional(payload, "maxDepth", maxDepth);
    optional(payload, "chunkSize", chunkSize);
    optional(payload, "overlap", overlap);
    optional(payload, tableName !== undefined && tableName !== null ? "tableName" : "table", tableName ?? table);
    return crawlResponseFrom(await this.jsonRequest("POST", "/api/knowledge/crawl", payload, options));
  }

  async documentChunks(documentId, options) {
    const response = await this.request("GET", `/api/knowledge/${encodePath(documentId)}/chunks`, options);
    return documentChunksFrom(response);
  }

  chunks(documentId, options) { return this.documentChunks(documentId, options); }

  async getDocumentText(identifier, options) {
    return documentTextFrom(await this.request("GET", `/api/knowledge/${encodePath(identifier)}`, options));
  }

  documentText(identifier, options) { return this.getDocumentText(identifier, options); }

  async replaceDocument(identifier, text, {
    title,
    sourceType,
    sourceUri,
    metadata,
    chunkSize,
    overlap,
    table,
    tableName,
    ...options
  } = {}) {
    const payload = { text: requireText(text, "text") };
    optional(payload, "title", title);
    optional(payload, "sourceType", sourceType);
    optional(payload, "sourceUri", sourceUri);
    optional(payload, "metadata", metadata);
    optional(payload, "chunkSize", chunkSize);
    optional(payload, "overlap", overlap);
    optional(payload, tableName !== undefined && tableName !== null ? "tableName" : "table", tableName ?? table);
    return ingestResultFrom(await this.jsonRequest("PUT", `/api/knowledge/${encodePath(identifier)}`, payload, options));
  }

  replaceKnowledge(identifier, text, options) { return this.replaceDocument(identifier, text, options); }

  deleteDocument(documentId, options) {
    return this.request("DELETE", `/api/knowledge/${encodePath(documentId)}`, options);
  }

  ensureIndex({ table, tableName, ...options } = {}) {
    const payload = {};
    optional(payload, tableName !== undefined && tableName !== null ? "tableName" : "table", tableName ?? table);
    return this.jsonRequest("POST", "/api/index/ensure", payload, options);
  }

  async listPeers(options) {
    const response = await this.request("GET", "/api/cluster/peers", options) || {};
    return Array.isArray(response.peers) ? response.peers.map(peerFrom) : [];
  }

  async addPeer(url, { priority = 100, ...options } = {}) {
    const response = await this.jsonRequest("POST", "/api/cluster/peers", { url: requireText(url, "url"), priority }, options);
    return peerFrom(response?.peer);
  }

  syncPeer(peerId, options) {
    return this.jsonRequest("POST", `/api/cluster/peers/${encodePath(peerId)}/sync`, {}, options);
  }

  removePeer(peerId, options) {
    return this.request("DELETE", `/api/cluster/peers/${encodePath(peerId)}`, options);
  }
}

export const Client = ConstellationClient;
