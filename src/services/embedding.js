import { pipeline } from "@huggingface/transformers";
import { config } from "../config.js";
import { sha256 } from "../util.js";
import "./model-runtime.js";

let extractorPromise;
let dimension = null;
let ready = false;
let lastError = null;
export const embeddingFingerprint = sha256(JSON.stringify({
  provider: "transformers.js-local",
  model: config.embedding.model,
  dtype: config.embedding.dtype,
  pooling: config.embedding.pooling,
  normalize: config.embedding.normalize
}));

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", config.embedding.model, { dtype: config.embedding.dtype })
      .then((value) => { ready = true; lastError = null; return value; })
      .catch((error) => { extractorPromise = null; ready = false; lastError = error?.message || String(error); throw error; });
  }
  return extractorPromise;
}

export async function embedLocal(inputs) {
  const texts = Array.isArray(inputs) ? inputs : [inputs];
  if (!texts.length) return [];
  const extractor = await getExtractor();
  const vectors = [];
  for (let i = 0; i < texts.length; i += config.embedding.batchSize) {
    const batch = texts.slice(i, i + config.embedding.batchSize);
    const output = await extractor(batch, { pooling: config.embedding.pooling, normalize: config.embedding.normalize });
    const rows = output.tolist();
    const normalizedRows = batch.length === 1 && typeof rows?.[0]?.[0] !== "number" ? [rows.flat()] : rows;
    for (const row of normalizedRows) vectors.push(Array.from(row, Number));
  }
  dimension ||= vectors[0]?.length || null;
  return vectors;
}

export async function warmEmbedding() {
  await embedLocal(["Constellation embedding warmup"]);
  return embeddingInfo();
}

export function embeddingInfo() {
  return {
    provider: "transformers.js-local",
    local: true,
    model: config.embedding.model,
    dtype: config.embedding.dtype,
    dimension,
    fingerprint: embeddingFingerprint,
    ready,
    error: lastError
  };
}
