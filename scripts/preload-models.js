import { config } from "../src/config.js";
import { modelRuntimeInfo } from "../src/services/model-runtime.js";
import { warmEmbedding } from "../src/services/embedding.js";
import { warmReranker } from "../src/services/rerank.js";

console.log("[constellation] preparing local AI models");
console.log("[constellation] runtime", modelRuntimeInfo());
console.log(`[constellation] embedding: ${config.embedding.model} (${config.embedding.dtype})`);
console.log(`[constellation] reranker: ${config.rerank.model} (${config.rerank.dtype})`);
await warmEmbedding();
await warmReranker();
console.log("[constellation] local models are ready in", config.models.cacheDir);
