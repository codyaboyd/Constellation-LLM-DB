# Constellation

Constellation is a self-hosted, open source knowledge platform for search, retrieval-augmented generation (RAG), and enterprise document discovery. It turns documents, notes, and web pages into a searchable knowledge base that your applications can query through a dashboard or authenticated API.

Constellation is designed for teams that want useful, grounded search without sending their knowledge or model requests to a hosted inference service. Embeddings and reranking run locally through Transformers.js and ONNX, and the indexed knowledge stays in local SQLite and LanceDB data files. Once the model cache is populated, it can run with remote model access disabled.

## Why use Constellation?

Constellation helps you build knowledge-aware applications while keeping the retrieval layer under your control:

- Keep documents, vectors, and inference on infrastructure you operate.
- Give an LLM application relevant source passages instead of asking it to search an unstructured folder.
- Improve retrieval quality with a two-stage vector search and local cross-encoder reranker.
- Start with one all-in-one deployment and add workers or replicas as usage grows.
- Use the browser dashboard for exploration and administration, or the JSON API for automation.
- Run in restricted or air-gapped environments after provisioning the model cache.

Constellation retrieves and ranks knowledge; it does not generate final natural-language answers. This makes it useful as the grounded retrieval layer beneath an assistant, support tool, research workflow, or internal search application.

## What it does

The normal flow is:

```text
documents / notes / web pages
              │
              ▼
      extract and normalize text
              │
              ▼
       split into searchable chunks
              │
              ▼
    local embedding model creates vectors
              │
              ▼
       LanceDB stores the knowledge
              │
              ▼
        user question is embedded
              │
              ▼
      vector search finds candidates
              │
              ▼
 optional local reranker improves ordering
              │
              ▼
       relevant passages and metadata
```

## Features

### Knowledge ingestion

- Upload PDF, DOCX, Markdown, and TXT files.
- Add manual text such as policies, notes, or short reference entries.
- Crawl bounded HTTP/HTTPS websites, with same-origin crawling enabled by default.
- Normalize, chunk, embed, and index content in one ingestion operation.
- Review indexed source metadata, chunk counts, and source URIs from the dashboard.
- Delete a source and all of its indexed chunks.

### Retrieval and local inference

- LanceDB vector search with cosine distance by default.
- Configurable candidate count, final result count, minimum score, filters, `nprobes`, and index refinement.
- Optional local Jina Reranker Turbo cross-encoder for more precise result ordering.
- Standalone embedding and reranking endpoints for applications that need those capabilities directly.
- Model readiness, fingerprints, cache location, and local/remote runtime state are visible through the API and dashboard.

### Dashboard and operations

- Password-protected Bootstrap dashboard.
- Overview of vector count, documents, connected deployments, model readiness, load, and active model tasks.
- Query playground for testing retrieval settings and inspecting JSON results.
- Settings screen for node, cluster, scheduling, and crawler configuration.
- Local model preload action to reduce first-request latency.
- Locally served UI assets with no Bootstrap CDN dependency.

### Distributed deployments

- Run as a standalone all-in-one node.
- Use a gateway to coordinate requests and schedule model work.
- Add workers for embedding and reranking capacity.
- Add replicas for additional copies of knowledge.
- Replicate document changes with a durable SQLite outbox and retry handling.
- Schedule work only to peers with matching embedding and reranker fingerprints.
- Fall back to local inference when a suitable worker is unavailable.

## Recommended system requirements

Constellation runs CPU-only; a GPU is not required for the default quantized models. Local model inference is CPU- and memory-intensive, especially when reranking many candidates, so the following are practical recommendations rather than hard limits.

| Component | Small local evaluation | Recommended production starting point |
| --- | --- | --- |
| OS/architecture | 64-bit Linux, macOS, or another Bun-supported environment | 64-bit Linux x86_64 with native LanceDB/ONNX dependencies validated on the target host |
| Runtime | Current stable Bun release | Current stable Bun release, pinned and tested in deployment |
| CPU | 4 logical cores | 8 or more logical cores |
| Memory | 8 GB RAM for a small corpus and light concurrency | 16 GB RAM or more for normal document collections and concurrent requests |
| Storage | 5 GB free SSD space for dependencies, model cache, and application data | 10 GB or more of fast SSD space, plus room for the corpus, vectors, logs, and backups |
| Network | Internet access during dependency/model setup, or a pre-populated cache | Internal connectivity between cluster nodes; outbound access can be disabled after model provisioning |
| Browser | A current Chrome, Firefox, Safari, or Edge release | A current browser for the administration dashboard |

The default model cache is small compared with the application dependencies, but its size depends on the models you configure. LanceDB and SQLite storage grow with the number and size of indexed chunks. Increase CPU and memory for larger corpora, higher `candidateK` values, reranking-heavy workloads, or multiple simultaneous ingestion jobs.

For production, use a persistent SSD-backed `DATA_DIR`, monitor disk growth, and back up both the SQLite metadata database and the LanceDB directory together.

## Quick start

### 1. Install prerequisites

Install Bun on the host. Constellation uses Bun-specific features including `bun:sqlite`, `Bun.serve`, and Bun's password hashing APIs; Node.js alone is not a substitute runtime.

### 2. Configure the first node

From the project directory:

```bash
cp .env.example .env
```

Edit `.env` before the first boot. At minimum, set a strong dashboard password and a long random session secret:

```env
CONSTELLATION_PASSWORD=replace-with-a-strong-password
SESSION_SECRET=replace-with-a-long-random-secret
```

If `CONSTELLATION_API_KEY` is left empty, Constellation generates an API key, stores it in `data/constellation.sqlite`, and prints it once at startup. Save that key in your secret manager. You can also provide your own key in `.env`.

### 3. Install dependencies and prepare local models

```bash
bun install
bun run models:prepare
```

The model preparation command downloads the configured embedding and reranking models into `MODEL_CACHE_DIR` and warms them up. The first download can take longer than later starts.

### 4. Start Constellation

```bash
bun start
```

The default dashboard address is:

```text
http://127.0.0.1:4317
```

Sign in with `CONSTELLATION_PASSWORD`, then follow this path:

1. Open **Overview** and confirm that the local models are ready. **Load local models** can warm them manually.
2. Open **Knowledge** and upload a file, paste manual text, or crawl a site.
3. Open **Query** and ask a question. Leave reranking enabled for the usual higher-precision path.
4. Use **Connections** and **Settings** when adding nodes or changing deployment behavior.

For development with automatic source reloads:

```bash
bun run dev
```

## Using the dashboard

### Add knowledge

The **Knowledge** screen supports four common workflows:

- **Upload:** choose a PDF, DOCX, Markdown, or TXT file and optionally provide a title.
- **Manual entry:** provide a title and paste text directly into the knowledge base.
- **Web crawl:** provide an HTTP/HTTPS starting URL, a maximum page count, and a crawl depth.
- **Indexed documents:** inspect source type, chunk count, and URI; delete a source when it should no longer be searchable.

Every source is extracted, normalized, split into chunks, embedded locally, and written to LanceDB. Use descriptive titles and start web crawls with a small page/depth limit so you can verify the extracted content before expanding the crawl.

### Query knowledge

The **Query** screen exposes the retrieval pipeline for testing:

- **Top K:** maximum number of final passages returned.
- **Candidate K:** number of vector-search candidates considered before final selection. Increase it when relevant content is being missed.
- **Rerank:** run the local Jina cross-encoder over candidates to improve ordering.
- **Min score:** discard low-scoring cosine results.
- **LanceDB SQL filter:** restrict results by stored fields such as `source_type`.
- **nprobes** and **Refine:** advanced LanceDB search controls; leave them blank unless tuning an index.

Start with the defaults, reranking enabled, and a modest `Candidate K`. Return only the number of passages your downstream application needs.

## API usage

API routes accept either:

```text
Authorization: Bearer <api-key>
```

or:

```text
X-API-Key: <api-key>
```

`GET /health` is public and returns the process health and node role. Other application routes require authentication. Dashboard mutations use a signed session with CSRF protection; cluster-to-cluster traffic uses `X-Constellation-Cluster-Secret`.

### Query example

```bash
export CONSTELLATION_URL="http://127.0.0.1:4317"
export CONSTELLATION_API_KEY="your-api-key"

curl "$CONSTELLATION_URL/api/query" \
  -H "Authorization: Bearer $CONSTELLATION_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "query": "What is the refund policy?",
    "candidateK": 20,
    "topK": 5,
    "rerank": true
  }'
```

The response contains the selected passage text and source metadata, including the document ID, title, source type, source URI, chunk index, and vector/reranker scores when available. Pass those passages to your application’s answer-generation step if you are building a RAG assistant.

### Main endpoints

| Method and route | Purpose |
| --- | --- |
| `GET /health` | Public process health check. |
| `GET /api/status` | Authenticated node, storage, model, and peer status. |
| `GET /api/models` | Model configuration, readiness, fingerprints, and cache runtime. |
| `POST /api/models/preload` | Warm the local models. |
| `GET /api/knowledge` | List indexed documents. |
| `POST /api/knowledge/manual` | Ingest a JSON text entry. |
| `POST /api/knowledge/upload` | Ingest a PDF, DOCX, Markdown, or TXT multipart upload. |
| `POST /api/knowledge/crawl` | Crawl and ingest bounded web content. |
| `DELETE /api/knowledge/:id` | Delete a document and its chunks. |
| `POST /api/query` | Embed a question, search LanceDB, and optionally rerank results. |
| `POST /api/embeddings` | Create local embeddings for one or more text inputs. |
| `POST /api/rerank` | Locally rerank a query against supplied documents. |
| `POST /api/index/ensure` | Create the LanceDB vector index when the corpus is large enough and no index exists. |
| `GET/POST/DELETE /api/cluster/peers` | Inspect and manage connected deployments. |

### Embedding example

```bash
curl "$CONSTELLATION_URL/api/embeddings" \
  -H "Authorization: Bearer $CONSTELLATION_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"inputs":["First passage","Second passage"]}'
```

### Reranking example

```bash
curl "$CONSTELLATION_URL/api/rerank" \
  -H "Authorization: Bearer $CONSTELLATION_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "query": "Which passage explains the refund window?",
    "documents": [
      "Refunds may be requested within 30 days.",
      "Employees receive twenty vacation days."
    ],
    "topN": 2,
    "returnDocuments": true
  }'
```

## Local models and offline operation

Constellation uses local model inference by default:

```env
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
EMBEDDING_DTYPE=q8

JINA_RERANKER_MODEL=jinaai/jina-reranker-v1-turbo-en
JINA_RERANKER_DTYPE=q8
JINA_RERANKER_BATCH_SIZE=16
JINA_RERANKER_MAX_TOKENS=8192
```

The embedding model converts text into vectors for semantic search. The reranker scores query/document pairs as a local cross-encoder and improves the final order. No Jina API, `JINA_API_KEY`, or external reranking service is used.

Models are cached under `data/model-cache/` by default:

```env
MODEL_CACHE_DIR=./data/model-cache
TRANSFORMERS_ALLOW_REMOTE=true
MODEL_PRELOAD=true
```

For an air-gapped deployment:

1. Run `bun run models:prepare` on a connected machine.
2. Copy the populated model cache to the deployment host, or configure `TRANSFORMERS_LOCAL_MODEL_PATH` with a pre-provisioned model tree.
3. Set `TRANSFORMERS_ALLOW_REMOTE=false`.
4. Start Constellation and verify readiness through **Overview** or `GET /api/models`.

With remote access disabled, Transformers.js will use local/cache files only and will not download missing models.

## Distributed Constellation mode

Use a cluster when one node should coordinate requests, model work should be spread across several machines, or knowledge should have a second storage location.

### Deployment roles

| Role | Behavior |
| --- | --- |
| `standalone` | All-in-one dashboard, API, storage, embeddings, and reranking. Recommended starting point. |
| `gateway` | Dashboard/API and storage coordinator. Prefers compatible workers and falls back to local inference. |
| `worker` | Provides embedding and reranking compute to other nodes; does not advertise storage. |
| `replica` | Stores replicated knowledge; does not advertise model compute. |
| `hybrid` | Gateway, storage node, and local compute fallback in one deployment. |

The gateway chooses healthy workers using configured preference, current system load, and active model tasks. It only sends embedding work to workers with the same embedding fingerprint and reranking work to workers with the same reranker fingerprint. This avoids mixing incompatible vector spaces or ranking behavior.

Knowledge mutations (`upsert_document` and `delete_document`) can be replicated to storage-capable peers. If a peer is unavailable, the event is retained in SQLite and retried with exponential backoff. **Connections → Sync** can initialize a storage node with the current document metadata, chunks, and vectors.

### Basic cluster configuration

Set the same shared secret on every linked deployment. A gateway might use:

```env
NODE_ROLE=gateway
NODE_NAME=constellation-gateway
PUBLIC_BASE_URL=http://gateway-host:4317
CLUSTER_SHARED_SECRET=use-the-same-long-secret-on-all-nodes
```

A worker might use:

```env
NODE_ROLE=worker
NODE_NAME=constellation-worker-1
PUBLIC_BASE_URL=http://worker-1:4317
GATEWAY_URL=http://gateway-host:4317
CLUSTER_SHARED_SECRET=use-the-same-long-secret-on-all-nodes

EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
EMBEDDING_DTYPE=q8
JINA_RERANKER_MODEL=jinaai/jina-reranker-v1-turbo-en
JINA_RERANKER_DTYPE=q8
```

For air-gapped workers, provision the same model cache and set `TRANSFORMERS_ALLOW_REMOTE=false`. Start both nodes, then add the worker address from the gateway’s **Connections** screen. The nodes must be able to reach one another over HTTP or HTTPS and must share the cluster secret.

## Configuration reference

Copy `.env.example` for the complete set of options. The most important settings are:

| Setting | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address. |
| `PORT` | `4317` | HTTP port. |
| `DATA_DIR` | `./data` | SQLite, LanceDB, and default model-cache parent directory. |
| `CONSTELLATION_PASSWORD` | none | First-boot dashboard password; stored as a hash. |
| `CONSTELLATION_PASSWORD_HASH` | none | Existing Bun/Argon2-compatible dashboard password hash. |
| `CONSTELLATION_API_KEY` | generated | API credential. Leave empty to generate and persist one. |
| `SESSION_SECRET` | development fallback | Secret used to sign dashboard sessions; set a long random value. |
| `MODEL_CACHE_DIR` | `./data/model-cache` | Local model cache. |
| `TRANSFORMERS_ALLOW_REMOTE` | `true` | Permit remote model downloads when cache files are missing. |
| `TRANSFORMERS_LOCAL_MODEL_PATH` | unset | Optional pre-provisioned local model tree. |
| `EMBEDDING_MODEL` / `EMBEDDING_DTYPE` | `Xenova/all-MiniLM-L6-v2` / `q8` | Local embedding model configuration. |
| `JINA_RERANKER_MODEL` / `JINA_RERANKER_DTYPE` | `jinaai/jina-reranker-v1-turbo-en` / `q8` | Local reranker configuration. |
| `NODE_ROLE` | `standalone` | Deployment role. |
| `NODE_NAME` | `constellation-node` | Human-readable node name. |
| `PUBLIC_BASE_URL` | local URL | Address peers use to reach this deployment. |
| `GATEWAY_URL` | unset | Gateway address for non-gateway nodes. |
| `CLUSTER_SHARED_SECRET` | unset | Shared secret for internal cluster traffic. |
| `CRAWL_MAX_PAGES` | `30` | Default crawl page limit; a request is capped at 200 pages. |
| `CRAWL_MAX_DEPTH` | `2` | Default crawl depth; a request is capped at depth 5. |
| `CRAWL_MAX_BYTES_PER_PAGE` | `2000000` | Maximum downloaded page size. |
| `ALLOW_PRIVATE_CRAWL` | `false` | Allow crawling private network addresses; enable only for trusted internal sources. |

The node, cluster, scheduling, and crawler settings can also be changed from the dashboard **Settings** screen. On first boot, they are seeded from `.env`; after that, values saved in `data/constellation.sqlite` take precedence over the environment file.

## Crawler safety

The built-in crawler is intentionally bounded. It supports HTTP/HTTPS, validates redirect destinations, follows basic `robots.txt` rules, removes common non-content HTML elements, enforces page/depth/size limits, and stays on the starting origin by default. Localhost and private IPv4/IPv6 addresses are blocked unless `ALLOW_PRIVATE_CRAWL=true`.

Enable private crawling only when the deployment is intentionally indexing trusted internal documentation, and keep the crawler limits appropriate for that network.

## Data layout and backups

```text
data/
├── constellation.sqlite   # settings, documents, peers, replication state, secrets
├── lancedb/               # searchable chunks and vectors
└── model-cache/           # Transformers.js model/tokenizer/ONNX assets
```

Back up `data/constellation.sqlite` and `data/lancedb/` together. Include `data/model-cache/` in an offline deployment image or back it up separately if rebuilding the host would be inconvenient. Do not commit `.env`, API keys, passwords, cluster secrets, or private knowledge data to source control.

## Security and production checklist

- Replace the example dashboard password before first boot.
- Use a long random `SESSION_SECRET` and `CLUSTER_SHARED_SECRET`.
- Keep the generated or configured API key private.
- Put the service behind TLS when it is reachable outside a trusted network.
- Restrict `/internal/*` network access to cluster members.
- Use the same embedding and reranker model configuration on compatible workers.
- Persist `DATA_DIR` on reliable storage and back it up.
- Monitor disk, memory, model load, and the replication outbox.
- Enable `ALLOW_PRIVATE_CRAWL` only when internal crawling is required.
- Benchmark `candidateK`, reranking, batch sizes, and worker count with your actual corpus and concurrency.

## Development commands

```bash
bun run dev           # watch mode
bun start             # production-style start
bun run models:prepare
bun run check         # syntax-check src/server.js
bun test
```
