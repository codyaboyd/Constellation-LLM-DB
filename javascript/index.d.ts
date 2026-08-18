export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
}

export interface Health {
  ok: boolean;
  role: string;
}

export interface Document {
  id: string;
  title: string;
  tableName: string;
  sourceType: string;
  sourceUri: string;
  sha256: string | null;
  chunkCount: number;
  status: string | null;
  originNode: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
  raw: Record<string, unknown>;
}

export interface QueryResult {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  title: string;
  sourceType: string;
  sourceUri: string;
  metadata: Record<string, unknown>;
  vectorScore: number | null;
  rerankScore: number | null;
  originalRank: number | null;
  distance: number | null;
  raw: Record<string, unknown>;
}

export interface QueryResponse {
  query: string;
  tableName: string;
  results: QueryResult[];
}

export interface EmbeddingResponse {
  model: Record<string, unknown>;
  vectors: number[][];
}

export interface RerankResult {
  index: number;
  relevanceScore: number;
  document: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface RerankResponse {
  model: string | null;
  local: boolean | null;
  results: RerankResult[];
}

export interface IngestResult {
  document: Document;
  chunks: number;
  replicatedViaGateway: boolean;
  raw: Record<string, unknown>;
}

export interface CrawlResponse {
  pages: number;
  results: IngestResult[];
  raw: Record<string, unknown>;
}

export interface Chunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  raw: Record<string, unknown>;
}

export interface DocumentChunks {
  document: Record<string, unknown>;
  chunks: Chunk[];
  raw: Record<string, unknown>;
}

export interface DocumentText {
  document: Document;
  text: string;
  raw: Record<string, unknown>;
}

export interface Peer {
  nodeId: string;
  url: string;
  name: string | null;
  reachable: boolean | null;
  status: string | null;
  role: string | null;
  priority: number | null;
  capabilities: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface QueryOptions extends RequestOptions {
  topK?: number;
  candidateK?: number;
  rerank?: boolean;
  rerankTopK?: number;
  minScore?: number;
  filter?: string;
  nprobes?: number;
  refineFactor?: number;
  distanceType?: string;
  table?: string;
  tableName?: string;
}

export interface IngestTextOptions extends RequestOptions {
  metadata?: Record<string, unknown>;
  chunkSize?: number;
  overlap?: number;
  table?: string;
  tableName?: string;
}

export interface UploadFileOptions extends RequestOptions {
  filename?: string;
  title?: string;
  chunkSize?: number;
  overlap?: number;
  table?: string;
  tableName?: string;
}

export interface CrawlOptions extends RequestOptions {
  maxPages?: number;
  maxDepth?: number;
  sameOrigin?: boolean;
  chunkSize?: number;
  overlap?: number;
  table?: string;
  tableName?: string;
}

export interface ReplaceDocumentOptions extends RequestOptions {
  title?: string;
  sourceType?: string;
  sourceUri?: string;
  metadata?: Record<string, unknown>;
  chunkSize?: number;
  overlap?: number;
  table?: string;
  tableName?: string;
}

export class ConstellationError extends Error {}
export class ConstellationConnectionError extends ConstellationError {}
export class ConstellationTimeoutError extends ConstellationConnectionError {}
export class ConstellationAPIError extends ConstellationError {
  status: number;
  statusCode: number;
  message: string;
  method: string;
  url: string;
  details: unknown;
}
export class AuthenticationError extends ConstellationAPIError {}
export class NotFoundError extends ConstellationAPIError {}

export class ConstellationClient {
  constructor(options?: ClientOptions);
  static fromEnv(options?: ClientOptions): ConstellationClient;
  baseUrl: string;
  apiKey?: string;
  timeout: number;
  request(method: string, path: string, options?: RequestOptions & { body?: unknown; headers?: HeadersInit; authenticated?: boolean }): Promise<any>;
  health(options?: RequestOptions): Promise<Health>;
  status(options?: RequestOptions): Promise<Record<string, unknown>>;
  models(options?: RequestOptions): Promise<Record<string, unknown>>;
  settings(options?: RequestOptions): Promise<Record<string, unknown>>;
  getSettings(options?: RequestOptions): Promise<Record<string, unknown>>;
  updateSettings(settings: Record<string, unknown>, options?: RequestOptions & { clearSecrets?: string[] }): Promise<Record<string, unknown>>;
  preloadModels(options?: RequestOptions): Promise<Record<string, unknown>>;
  query(query: string, options?: QueryOptions): Promise<QueryResponse>;
  search(query: string, options?: QueryOptions): Promise<QueryResponse>;
  createEmbeddings(inputs: string | Iterable<string>, options?: RequestOptions): Promise<EmbeddingResponse>;
  embeddings(inputs: string | Iterable<string>, options?: RequestOptions): Promise<EmbeddingResponse>;
  embed(inputs: string | Iterable<string>, options?: RequestOptions): Promise<number[] | number[][]>;
  rerank(query: string, documents: Array<string | Record<string, unknown>>, options?: RequestOptions & { topN?: number; returnDocuments?: boolean }): Promise<RerankResponse>;
  listDocuments(options?: RequestOptions): Promise<Document[]>;
  documents(options?: RequestOptions): Promise<Document[]>;
  listTables(options?: RequestOptions): Promise<string[]>;
  tables(options?: RequestOptions): Promise<string[]>;
  ingestText(title: string, text: string, options?: IngestTextOptions): Promise<IngestResult>;
  uploadFile(file: Blob | Uint8Array | string | { arrayBuffer(): Promise<ArrayBuffer>; name?: string }, options?: UploadFileOptions): Promise<IngestResult>;
  crawl(url: string, options?: CrawlOptions): Promise<CrawlResponse>;
  documentChunks(documentId: string, options?: RequestOptions): Promise<DocumentChunks>;
  chunks(documentId: string, options?: RequestOptions): Promise<DocumentChunks>;
  getDocumentText(identifier: string, options?: RequestOptions): Promise<DocumentText>;
  documentText(identifier: string, options?: RequestOptions): Promise<DocumentText>;
  replaceDocument(identifier: string, text: string, options?: ReplaceDocumentOptions): Promise<IngestResult>;
  replaceKnowledge(identifier: string, text: string, options?: ReplaceDocumentOptions): Promise<IngestResult>;
  deleteDocument(documentId: string, options?: RequestOptions): Promise<Record<string, unknown>>;
  ensureIndex(options?: RequestOptions & { table?: string; tableName?: string }): Promise<Record<string, unknown>>;
  listPeers(options?: RequestOptions): Promise<Peer[]>;
  addPeer(url: string, options?: RequestOptions & { priority?: number }): Promise<Peer>;
  syncPeer(peerId: string, options?: RequestOptions): Promise<Record<string, unknown>>;
  removePeer(peerId: string, options?: RequestOptions): Promise<Record<string, unknown>>;
}

export const Client: typeof ConstellationClient;
export const version: string;

export function documentFrom(value: unknown): Document;
export function queryResultFrom(value: unknown): QueryResult;
export function queryResponseFrom(value: unknown): QueryResponse;
export function embeddingResponseFrom(value: unknown): EmbeddingResponse;
export function rerankResultFrom(value: unknown): RerankResult;
export function rerankResponseFrom(value: unknown): RerankResponse;
export function ingestResultFrom(value: unknown): IngestResult;
export function crawlResponseFrom(value: unknown): CrawlResponse;
export function chunkFrom(value: unknown): Chunk;
export function documentChunksFrom(value: unknown): DocumentChunks;
export function documentTextFrom(value: unknown): DocumentText;
export function peerFrom(value: unknown): Peer;
