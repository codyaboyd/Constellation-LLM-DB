# Constellation Python client

`constellation-client` is a dependency-free Python client for the authenticated
Constellation JSON API. It provides a small typed wrapper around retrieval,
knowledge ingestion, embeddings, reranking, model management, and cluster
operations.

## Install

From a checkout:

```bash
pip install ./python
```

Once published, the same package can be installed with `pip install
constellation-client`.

## Quick start

```python
from constellation_client import Client

client = Client.from_env()
answer_context = client.query(
    "What is the refund policy?",
    top_k=5,
    rerank=True,
)

for result in answer_context.results:
    print(result.title, result.text)
```

`Client.from_env()` reads `CONSTELLATION_URL` (defaulting to
`http://127.0.0.1:4317`) and `CONSTELLATION_API_KEY`.

## Common operations

```python
from pathlib import Path
from constellation_client import Client

client = Client("https://constellation.example.com", api_key="cst_...")

client.ingest_text(
    title="Refund policy",
    text="Refunds may be requested within 30 days.",
    metadata={"team": "support"},
)
client.ingest_text(
    title="Agent note",
    text="Private context for agent A.",
    table_name="agent_a",
)
private_context = client.query("What is private to agent A?", table_name="agent_a")
client.upload_file(Path("handbook.pdf"))

vectors = client.embed(["first passage", "second passage"])
ranking = client.rerank(
    "Which passage explains the refund window?",
    ["Refunds may be requested within 30 days.", "Employees receive vacation days."],
)
```

The client also exposes `list_documents()`, `document_chunks()`,
`get_document_text()`, `replace_document()`, `delete_document()`, `crawl()`, `models()`, `preload_models()`,
`ensure_index()`, and peer management methods. `AsyncClient` and
`AsyncConstellationClient` provide the same API for async applications using
`asyncio`.

The client uses only Python's standard library. It does not perform answer
generation; pass `QueryResult.text` and its source metadata to the model or
application that generates the final answer.
