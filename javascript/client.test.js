import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthenticationError,
  Client,
  ConstellationConnectionError,
  ConstellationTimeoutError
} from "./index.js";

function fakeFetch(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };
  fetch.calls = calls;
  return fetch;
}

test("query maps options, authentication, and response fields", async () => {
  const fetch = fakeFetch({
    body: {
      query: "refund policy",
      results: [{
        id: "doc:0",
        document_id: "doc",
        chunk_index: 0,
        text: "Refunds are available for 30 days.",
        title: "Policy",
        source_type: "manual",
        metadata_json: '{"team":"support"}',
        vector_score: 0.91
      }]
    }
  });
  const client = new Client({ baseUrl: "http://localhost:4317/", apiKey: "secret", fetch });

  const response = await client.query("refund policy", {
    topK: 3,
    candidateK: 12,
    rerank: false,
    minScore: 0.5,
    filter: "source_type = 'manual'"
  });

  assert.equal(response.results[0].metadata.team, "support");
  assert.equal(response.results[0].vectorScore, 0.91);
  assert.equal(fetch.calls[0].url, "http://localhost:4317/api/query");
  assert.equal(fetch.calls[0].init.headers.get("Authorization"), "Bearer secret");
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), {
    query: "refund policy",
    topK: 3,
    candidateK: 12,
    rerank: false,
    distanceType: "cosine",
    minScore: 0.5,
    filter: "source_type = 'manual'"
  });
});

test("health is public and embed has a convenient single-input shape", async () => {
  const fetch = fakeFetch(
    { body: { ok: true, role: "standalone" } },
    { body: { model: { dimension: 3 }, vectors: [[1, 2, 3]] } }
  );
  const client = new Client({ baseUrl: "http://localhost:4317", apiKey: "secret", fetch });

  assert.deepEqual(await client.health(), { ok: true, role: "standalone" });
  assert.deepEqual(await client.embed("hello"), [1, 2, 3]);
  assert.equal(fetch.calls[0].init.headers.has("Authorization"), false);
});

test("uploadFile creates a multipart request", async () => {
  const fetch = fakeFetch({
    status: 201,
    body: { document: { id: "doc", title: "notes.txt", source_type: "txt", chunk_count: 1 }, chunks: 1 }
  });
  const client = new Client({ baseUrl: "http://localhost:4317", apiKey: "secret", fetch });

  const result = await client.uploadFile(new Blob(["hello"]), { filename: "notes.txt", title: "Notes", chunkSize: 100 });
  assert.equal(result.document.id, "doc");
  const multipart = new Response(fetch.calls[0].init.body);
  assert.match(multipart.headers.get("Content-Type"), /^multipart\/form-data; boundary=/);
  const body = await multipart.text();
  assert.match(body, /name="title"\r\n\r\nNotes/);
  assert.match(body, /name="chunkSize"\r\n\r\n100/);
  assert.match(body, /filename="notes.txt"/);
  assert.match(body, /hello\r\n--/);
});

test("HTTP errors are typed and preserve response details", async () => {
  const fetch = fakeFetch({ status: 401, body: { error: "Bad API key" } });
  const client = new Client({ baseUrl: "http://localhost:4317", fetch });

  await assert.rejects(() => client.status(), (error) => {
    assert.ok(error instanceof AuthenticationError);
    assert.equal(error.statusCode, 401);
    assert.equal(error.message, "Bad API key");
    assert.deepEqual(error.details, { error: "Bad API key" });
    return true;
  });
});

test("connection and timeout failures have distinct error types", async () => {
  const connectionClient = new Client({
    baseUrl: "http://localhost:4317",
    fetch: async () => { throw new TypeError("network down"); }
  });
  await assert.rejects(() => connectionClient.status(), ConstellationConnectionError);

  const timeoutClient = new Client({
    baseUrl: "http://localhost:4317",
    timeout: 5,
    fetch: (_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)))
  });
  await assert.rejects(() => timeoutClient.status(), ConstellationTimeoutError);
});

test("path parameters are encoded and fromEnv honors explicit overrides", async () => {
  const fetch = fakeFetch({ body: { document: {}, chunks: [] } });
  const client = new Client({ baseUrl: "https://example.test/base", fetch });
  await client.documentChunks("document/with spaces");
  assert.equal(fetch.calls[0].url, "https://example.test/base/api/knowledge/document%2Fwith%20spaces/chunks");

  const previousUrl = process.env.CONSTELLATION_URL;
  const previousKey = process.env.CONSTELLATION_API_KEY;
  process.env.CONSTELLATION_URL = "https://env.example.test";
  process.env.CONSTELLATION_API_KEY = "env-key";
  try {
    const fromEnv = Client.fromEnv({ fetch });
    assert.equal(fromEnv.baseUrl, "https://env.example.test");
    assert.equal(fromEnv.apiKey, "env-key");
  } finally {
    if (previousUrl === undefined) delete process.env.CONSTELLATION_URL;
    else process.env.CONSTELLATION_URL = previousUrl;
    if (previousKey === undefined) delete process.env.CONSTELLATION_API_KEY;
    else process.env.CONSTELLATION_API_KEY = previousKey;
  }
});

test("document text can be retrieved and replaced by ID or exact title", async () => {
  const fetch = fakeFetch(
    { body: { document: { id: "doc-1", title: "Support/Refunds", source_type: "manual" }, text: "Refunds are available." } },
    { body: { document: { id: "doc-1", title: "Support/Refunds", source_type: "manual" }, chunks: 1 } }
  );
  const client = new Client({ baseUrl: "https://example.test/base", apiKey: "secret", fetch });

  const current = await client.getDocumentText("Support/Refunds");
  assert.equal(current.document.id, "doc-1");
  assert.equal(current.text, "Refunds are available.");
  assert.equal(fetch.calls[0].url, "https://example.test/base/api/knowledge/Support%2FRefunds");

  const replaced = await client.replaceDocument("doc-1", "Refunds are available for 45 days.", { metadata: { team: "support" } });
  assert.equal(replaced.document.id, "doc-1");
  assert.equal(fetch.calls[1].url, "https://example.test/base/api/knowledge/doc-1");
  assert.deepEqual(JSON.parse(fetch.calls[1].init.body), {
    text: "Refunds are available for 45 days.",
    metadata: { team: "support" }
  });
});
