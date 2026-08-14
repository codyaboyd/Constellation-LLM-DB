# Constellation JavaScript client

`@constellation-ai/client` is a dependency-free async client for the
authenticated Constellation API. It works with native `fetch` in Node.js 18+,
Bun, Deno, browsers, and serverless runtimes.

## Install

From this repository:

```bash
npm install ./javascript
```

Once published:

```bash
npm install @constellation-ai/client
```

## Quick start

```js
import { Client } from "@constellation-ai/client";

const client = Client.fromEnv();
const context = await client.query("What is the refund policy?", {
  topK: 5,
  rerank: true
});

for (const result of context.results) {
  console.log(result.title, result.text);
}
```

`Client.fromEnv()` reads `CONSTELLATION_URL`, defaulting to
`http://127.0.0.1:4317`, and `CONSTELLATION_API_KEY`.

## Common operations

```js
await client.ingestText("Refund policy", "Refunds may be requested within 30 days.", {
  metadata: { team: "support" }
});

const vectors = await client.embed(["first passage", "second passage"]);
const ranking = await client.rerank("Which passage explains the refund window?", [
  "Refunds may be requested within 30 days.",
  "Employees receive vacation days."
]);

await client.uploadFile(new Blob(["A plain text note"]), { filename: "note.txt" });
const documents = await client.listDocuments();
const current = await client.getDocumentText("Refund policy");
await client.replaceDocument(current.document.id, "Refunds may be requested within 45 days.");
```

The client also exposes `health`, `status`, `models`, `settings`,
`preloadModels`, `crawl`, `documentChunks`, `getDocumentText`,
`replaceDocument`, `deleteDocument`, `ensureIndex`, and peer management methods.
Document text can be addressed by either document ID or exact title. Response models are normalized to camelCase and
retain the original server payload under `raw` where useful.

HTTP failures throw `ConstellationAPIError` or one of its typed subclasses:
`AuthenticationError`, `NotFoundError`, `ConstellationTimeoutError`, and
`ConstellationConnectionError`.
