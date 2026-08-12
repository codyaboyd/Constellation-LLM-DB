import path from "node:path";

const cwd = process.cwd();
const int = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bool = (value, fallback = false) => value == null ? fallback : /^(1|true|yes|on)$/i.test(String(value));
const dataDir = path.resolve(cwd, process.env.DATA_DIR || "./data");

const roles = ["standalone", "gateway", "worker", "replica", "hybrid"];
const normalizeUrl = (value) => String(value ?? "").trim().replace(/\/$/, "");
const normalizeString = (value, fallback, { allowEmpty = false } = {}) => {
  const result = String(value ?? "").trim();
  return result || (allowEmpty ? "" : fallback);
};

export const managedSettingDefinitions = Object.freeze([
  { key: "NODE_ROLE", path: ["node", "role"], type: "role", fallback: "standalone", envValue: process.env.NODE_ROLE },
  { key: "NODE_NAME", path: ["node", "name"], type: "string", fallback: "constellation-node", envValue: process.env.NODE_NAME },
  { key: "CLUSTER_SHARED_SECRET", path: ["node", "clusterSecret"], type: "secret", fallback: "", envValue: process.env.CLUSTER_SHARED_SECRET },
  { key: "GATEWAY_URL", path: ["node", "gatewayUrl"], type: "url", fallback: "", envValue: process.env.GATEWAY_URL },
  { key: "GATEWAY_LOCAL_COMPUTE_PENALTY", path: ["node", "gatewayComputePenalty"], type: "integer", min: 0, fallback: 10000, envValue: process.env.GATEWAY_LOCAL_COMPUTE_PENALTY },
  { key: "WORKER_BASE_PRIORITY", path: ["node", "workerBasePriority"], type: "integer", min: 0, fallback: 100, envValue: process.env.WORKER_BASE_PRIORITY },
  { key: "PEER_HEARTBEAT_TTL_MS", path: ["node", "heartbeatTtlMs"], type: "integer", min: 1, fallback: 30000, envValue: process.env.PEER_HEARTBEAT_TTL_MS },
  { key: "CRAWL_MAX_PAGES", path: ["crawl", "maxPages"], type: "integer", min: 1, fallback: 30, envValue: process.env.CRAWL_MAX_PAGES },
  { key: "CRAWL_MAX_DEPTH", path: ["crawl", "maxDepth"], type: "integer", min: 0, fallback: 2, envValue: process.env.CRAWL_MAX_DEPTH },
  { key: "CRAWL_MAX_BYTES_PER_PAGE", path: ["crawl", "maxBytesPerPage"], type: "integer", min: 1, fallback: 2_000_000, envValue: process.env.CRAWL_MAX_BYTES_PER_PAGE },
  { key: "ALLOW_PRIVATE_CRAWL", path: ["crawl", "allowPrivate"], type: "boolean", fallback: false, envValue: process.env.ALLOW_PRIVATE_CRAWL }
]);

function parseManagedValue(definition, rawValue, fallback = definition.fallback, strict = false) {
  if (definition.type === "role") {
    const value = String(rawValue ?? "").trim().toLowerCase();
    if (roles.includes(value)) return value;
    if (strict) throw new Error(`${definition.key} must be one of: ${roles.join(", ")}.`);
    return fallback;
  }
  if (definition.type === "integer") {
    const value = Number(rawValue);
    if (Number.isInteger(value) && value >= definition.min) return value;
    if (strict) throw new Error(`${definition.key} must be an integer greater than or equal to ${definition.min}.`);
    return fallback;
  }
  if (definition.type === "boolean") {
    if (typeof rawValue === "boolean") return rawValue;
    if (/^(1|true|yes|on)$/i.test(String(rawValue ?? ""))) return true;
    if (/^(0|false|no|off)$/i.test(String(rawValue ?? ""))) return false;
    if (strict) throw new Error(`${definition.key} must be true or false.`);
    return fallback;
  }
  if (definition.type === "url") {
    const value = normalizeUrl(rawValue);
    if (!value) return "";
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol)) return value;
    } catch {}
    if (strict) throw new Error(`${definition.key} must be an HTTP or HTTPS URL.`);
    return fallback;
  }
  const rawValueString = String(rawValue ?? "").trim();
  if (!rawValueString) {
    if (strict && definition.type !== "secret") throw new Error(`${definition.key} cannot be empty.`);
    return definition.type === "secret" ? "" : fallback;
  }
  return normalizeString(rawValueString, fallback, { allowEmpty: definition.type === "secret" });
}

const initialValues = Object.fromEntries(managedSettingDefinitions.map((definition) => [
  definition.key,
  parseManagedValue(definition, definition.envValue)
]));

function getPathValue(target, path) {
  return path.reduce((value, part) => value?.[part], target);
}
function setPathValue(target, path, value) {
  const property = path.at(-1);
  const parent = path.slice(0, -1).reduce((value, part) => value[part], target);
  parent[property] = value;
}

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: int(process.env.PORT, 4317),
  dataDir,
  dashboardPassword: process.env.CONSTELLATION_PASSWORD || "",
  dashboardPasswordHash: process.env.CONSTELLATION_PASSWORD_HASH || "",
  apiKey: process.env.CONSTELLATION_API_KEY || "",
  sessionSecret: process.env.SESSION_SECRET || "constellation-dev-session-secret-change-me",
  models: {
    cacheDir: path.resolve(cwd, process.env.MODEL_CACHE_DIR || path.join(dataDir, "model-cache")),
    localModelPath: process.env.TRANSFORMERS_LOCAL_MODEL_PATH || "",
    allowRemote: bool(process.env.TRANSFORMERS_ALLOW_REMOTE, true),
    preload: bool(process.env.MODEL_PRELOAD, true)
  },
  embedding: {
    model: process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",
    dtype: process.env.EMBEDDING_DTYPE || "q8",
    batchSize: int(process.env.EMBEDDING_BATCH_SIZE, 16),
    normalize: true,
    pooling: "mean"
  },
  rerank: {
    model: process.env.JINA_RERANKER_MODEL || "jinaai/jina-reranker-v1-turbo-en",
    dtype: process.env.JINA_RERANKER_DTYPE || "q8",
    batchSize: int(process.env.JINA_RERANKER_BATCH_SIZE, 16),
    maxTokens: int(process.env.JINA_RERANKER_MAX_TOKENS, 8192)
  },
  node: {
    role: initialValues.NODE_ROLE,
    name: initialValues.NODE_NAME,
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${int(process.env.PORT, 4317)}`).replace(/\/$/, ""),
    gatewayUrl: initialValues.GATEWAY_URL,
    clusterSecret: initialValues.CLUSTER_SHARED_SECRET,
    gatewayComputePenalty: initialValues.GATEWAY_LOCAL_COMPUTE_PENALTY,
    workerBasePriority: initialValues.WORKER_BASE_PRIORITY,
    heartbeatTtlMs: initialValues.PEER_HEARTBEAT_TTL_MS
  },
  crawl: {
    maxPages: initialValues.CRAWL_MAX_PAGES,
    maxDepth: initialValues.CRAWL_MAX_DEPTH,
    maxBytesPerPage: initialValues.CRAWL_MAX_BYTES_PER_PAGE,
    allowPrivate: initialValues.ALLOW_PRIVATE_CRAWL
  }
};

export function initializeManagedSettings(getSetting, setSetting) {
  for (const definition of managedSettingDefinitions) {
    if (getSetting(definition.key) === null) {
      setSetting(definition.key, serializeManagedSetting(definition.key, getPathValue(config, definition.path)));
    }
  }
  applyPersistedManagedSettings(getSetting);
}

export function applyPersistedManagedSettings(getSetting) {
  for (const definition of managedSettingDefinitions) {
    const storedValue = getSetting(definition.key);
    if (storedValue !== null) setPathValue(config, definition.path, parseManagedValue(definition, storedValue));
  }
}

export function normalizeManagedSettings(values, { clearSecrets = [] } = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("settings must be an object.");
  const normalized = {};
  for (const definition of managedSettingDefinitions) {
    if (!Object.hasOwn(values, definition.key)) continue;
    const rawValue = values[definition.key];
    if (definition.type === "secret" && !String(rawValue ?? "").trim() && !clearSecrets.includes(definition.key)) continue;
    normalized[definition.key] = parseManagedValue(definition, rawValue, definition.fallback, true);
  }
  return normalized;
}

export function applyManagedSettings(values) {
  for (const definition of managedSettingDefinitions) {
    if (Object.hasOwn(values, definition.key)) setPathValue(config, definition.path, values[definition.key]);
  }
}

export function serializeManagedSetting(key, value) {
  const definition = managedSettingDefinitions.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown managed setting: ${key}`);
  return definition.type === "boolean" ? (value ? "true" : "false") : String(value ?? "");
}

export function managedSettingsSnapshot({ includeSecrets = false } = {}) {
  const settings = {};
  const configured = {};
  for (const definition of managedSettingDefinitions) {
    const value = getPathValue(config, definition.path);
    configured[definition.key] = definition.type === "secret" ? Boolean(value) : true;
    settings[definition.key] = definition.type === "secret" && !includeSecrets ? "" : value;
  }
  return { settings, configured };
}

export const roleCapabilities = (role = config.node.role) => ({
  gateway: role === "gateway" || role === "hybrid" || role === "standalone",
  storage: role !== "worker",
  embed: role !== "replica",
  rerank: role !== "replica",
  dashboard: true
});
