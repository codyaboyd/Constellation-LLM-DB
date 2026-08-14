import asyncio
import io
import json
import os
import unittest
from urllib.error import HTTPError

from constellation_client import (
    AsyncClient,
    AuthenticationError,
    Client,
    DocumentText,
    QueryResponse,
)


class FakeResponse:
    def __init__(self, payload, status=200):
        self.body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def read(self):
        return self.body

    def getcode(self):
        return self.status


class FakeOpener:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append((request, timeout))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class ClientTests(unittest.TestCase):
    def test_query_maps_options_and_response(self):
        opener = FakeOpener(FakeResponse({
            "query": "refund policy",
            "results": [{
                "id": "doc:0",
                "document_id": "doc",
                "chunk_index": 0,
                "text": "Refunds are available for 30 days.",
                "title": "Policy",
                "source_type": "manual",
                "metadata_json": '{"team":"support"}',
                "vector_score": 0.91,
            }],
        }))
        client = Client("http://localhost:4317/", "secret", opener=opener)

        response = client.query(
            "refund policy",
            top_k=3,
            candidate_k=12,
            rerank=False,
            min_score=0.5,
            filter="source_type = 'manual'",
        )

        self.assertIsInstance(response, QueryResponse)
        self.assertEqual(response.results[0].metadata, {"team": "support"})
        self.assertEqual(response.results[0].vector_score, 0.91)
        request, timeout = opener.requests[0]
        self.assertEqual(request.full_url, "http://localhost:4317/api/query")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(timeout, 30.0)
        self.assertEqual(json.loads(request.data), {
            "query": "refund policy",
            "topK": 3,
            "candidateK": 12,
            "rerank": False,
            "distanceType": "cosine",
            "minScore": 0.5,
            "filter": "source_type = 'manual'",
        })

    def test_health_is_public_and_embeddings_have_convenience_shape(self):
        opener = FakeOpener(
            FakeResponse({"ok": True, "role": "standalone"}),
            FakeResponse({"model": {"dimension": 3}, "vectors": [[1, 2, 3]]}),
        )
        client = Client("http://localhost:4317", "secret", opener=opener)

        self.assertEqual(client.health().role, "standalone")
        self.assertEqual(client.embed("hello"), [1.0, 2.0, 3.0])
        self.assertIsNone(opener.requests[0][0].get_header("Authorization"))

    def test_upload_file_builds_multipart_request(self):
        opener = FakeOpener(FakeResponse({
            "document": {"id": "doc", "title": "notes.txt", "source_type": "txt", "chunk_count": 1},
            "chunks": 1,
        }, status=201))
        client = Client("http://localhost:4317", "secret", opener=opener)

        result = client.upload_file(io.BytesIO(b"hello"), filename="notes.txt", title="Notes", chunk_size=100)

        self.assertEqual(result.document.id, "doc")
        request, _ = opener.requests[0]
        self.assertIn("multipart/form-data; boundary=", request.get_header("Content-type"))
        body = request.data
        self.assertIn(b'name="title"\r\n\r\nNotes', body)
        self.assertIn(b'name="chunkSize"\r\n\r\n100', body)
        self.assertIn(b'filename="notes.txt"', body)
        self.assertIn(b"hello\r\n--", body)

    def test_http_errors_are_typed(self):
        error = HTTPError(
            "http://localhost:4317/api/query",
            401,
            "Unauthorized",
            {},
            io.BytesIO(b'{"error":"Bad API key"}'),
        )
        client = Client("http://localhost:4317", opener=FakeOpener(error))

        with self.assertRaises(AuthenticationError) as raised:
            client.status()
        self.assertEqual(raised.exception.status_code, 401)
        self.assertEqual(raised.exception.message, "Bad API key")

    def test_async_client_delegates_to_sync_client(self):
        opener = FakeOpener(FakeResponse({"ok": True, "role": "worker"}))
        client = AsyncClient("http://localhost:4317", opener=opener)

        health = asyncio.run(client.health())

        self.assertEqual(health.role, "worker")

    def test_from_env(self):
        old_url = os.environ.get("CONSTELLATION_URL")
        old_key = os.environ.get("CONSTELLATION_API_KEY")
        try:
            os.environ["CONSTELLATION_URL"] = "https://example.test/base"
            os.environ["CONSTELLATION_API_KEY"] = "env-key"
            client = Client.from_env(opener=FakeOpener())
            self.assertEqual(client.base_url, "https://example.test/base")
            self.assertEqual(client.api_key, "env-key")
        finally:
            if old_url is None:
                os.environ.pop("CONSTELLATION_URL", None)
            else:
                os.environ["CONSTELLATION_URL"] = old_url
            if old_key is None:
                os.environ.pop("CONSTELLATION_API_KEY", None)
            else:
                os.environ["CONSTELLATION_API_KEY"] = old_key

    def test_document_text_can_be_retrieved_and_replaced_by_id_or_title(self):
        opener = FakeOpener(
            FakeResponse({"document": {"id": "doc-1", "title": "Support/Refunds", "source_type": "manual"}, "text": "Refunds are available."}),
            FakeResponse({"document": {"id": "doc-1", "title": "Support/Refunds", "source_type": "manual"}, "chunks": 1}),
        )
        client = Client("https://example.test/base", "secret", opener=opener)

        current = client.get_document_text("Support/Refunds")
        self.assertIsInstance(current, DocumentText)
        self.assertEqual(current.document.id, "doc-1")
        self.assertEqual(current.text, "Refunds are available.")
        self.assertEqual(opener.requests[0][0].full_url, "https://example.test/base/api/knowledge/Support%2FRefunds")

        replaced = client.replace_document("doc-1", "Refunds are available for 45 days.", metadata={"team": "support"})
        self.assertEqual(replaced.document.id, "doc-1")
        request, _ = opener.requests[1]
        self.assertEqual(request.full_url, "https://example.test/base/api/knowledge/doc-1")
        self.assertEqual(json.loads(request.data), {
            "text": "Refunds are available for 45 days.",
            "metadata": {"team": "support"},
        })


if __name__ == "__main__":
    unittest.main()
