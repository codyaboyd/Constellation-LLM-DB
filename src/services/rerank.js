import { AutoModelForSequenceClassification, AutoTokenizer } from "@huggingface/transformers";
import { config } from "../config.js";
import { sha256 } from "../util.js";
import "./model-runtime.js";

let tokenizerPromise;
let modelPromise;
let ready = false;
let lastError = null;

export const rerankerFingerprint = sha256(JSON.stringify({
  provider: "transformers.js-local",
  model: config.rerank.model,
  dtype: config.rerank.dtype,
  maxTokens: config.rerank.maxTokens
}));

async function getTokenizer() {
  tokenizerPromise ||= AutoTokenizer.from_pretrained(config.rerank.model).catch((error) => {
    tokenizerPromise = null;
    lastError = error?.message || String(error);
    throw error;
  });
  return tokenizerPromise;
}

async function getModel() {
  if (!modelPromise) {
    modelPromise = AutoModelForSequenceClassification.from_pretrained(config.rerank.model, { dtype: config.rerank.dtype })
      .then((value) => { ready = true; lastError = null; return value; })
      .catch((error) => { modelPromise = null; ready = false; lastError = error?.message || String(error); throw error; });
  }
  return modelPromise;
}

function normalizeScoreRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => Array.isArray(row) ? Number(row[0]) : Number(row));
}

export async function rerankLocal(query, documents, { topN = documents.length, returnDocuments = true } = {}) {
  const q = String(query || "").trim();
  const docs = (Array.isArray(documents) ? documents : []).map((doc) => typeof doc === "string" ? doc : String(doc?.text ?? doc?.document?.text ?? ""));
  if (!q) throw new Error("query is required for reranking.");
  if (!docs.length) return { model: config.rerank.model, local: true, results: [] };

  const [tokenizer, model] = await Promise.all([getTokenizer(), getModel()]);
  const ranked = [];

  for (let start = 0; start < docs.length; start += config.rerank.batchSize) {
    const batch = docs.slice(start, start + config.rerank.batchSize);
    const inputs = tokenizer(new Array(batch.length).fill(q), {
      text_pair: batch,
      padding: true,
      truncation: true,
      max_length: config.rerank.maxTokens
    });
    const { logits } = await model(inputs);
    const scores = normalizeScoreRows(logits.sigmoid().tolist());
    for (let i = 0; i < batch.length; i++) {
      const index = start + i;
      ranked.push({
        index,
        relevance_score: scores[i],
        ...(returnDocuments ? { document: { text: docs[index] } } : {})
      });
    }
  }

  ranked.sort((a, b) => b.relevance_score - a.relevance_score);
  const limit = Math.max(1, Math.min(Number(topN) || docs.length, docs.length));
  return { model: config.rerank.model, local: true, results: ranked.slice(0, limit) };
}

export async function warmReranker() {
  await rerankLocal("Constellation reranker warmup", ["Constellation local knowledge reranking"], { topN: 1, returnDocuments: false });
  return rerankerInfo();
}

export function rerankerInfo() {
  return {
    provider: "transformers.js-local",
    local: true,
    model: config.rerank.model,
    dtype: config.rerank.dtype,
    maxTokens: config.rerank.maxTokens,
    batchSize: config.rerank.batchSize,
    fingerprint: rerankerFingerprint,
    ready,
    error: lastError
  };
}
