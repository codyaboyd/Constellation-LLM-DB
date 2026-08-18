"""Synchronous and asynchronous clients for the Constellation API."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any, BinaryIO, Callable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from .exceptions import (
    AuthenticationError,
    ConstellationAPIError,
    ConstellationConnectionError,
    ConstellationTimeoutError,
    NotFoundError,
)
from .models import (
    CrawlResponse,
    Document,
    DocumentChunks,
    DocumentText,
    EmbeddingResponse,
    Health,
    IngestResult,
    Peer,
    QueryResponse,
    RerankResponse,
)


Opener = Callable[..., Any]


def _optional(payload: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        payload[key] = value


def _require_text(value: str, name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{name} must not be empty")
    return text


def _json_body(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _decode_body(body: bytes) -> Any:
    if not body:
        return None
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return body.decode("utf-8", errors="replace")


def _error_details(body: bytes) -> tuple[str, Any]:
    details = _decode_body(body)
    if isinstance(details, Mapping):
        message = details.get("error") or details.get("message") or "Request failed"
        return str(message), details
    return str(details or "Request failed"), details


def _api_error(status: int, message: str, *, method: str, url: str, details: Any) -> ConstellationAPIError:
    error_type: type[ConstellationAPIError]
    if status in (401, 403):
        error_type = AuthenticationError
    elif status == 404:
        error_type = NotFoundError
    else:
        error_type = ConstellationAPIError
    return error_type(status, message, method=method, url=url, details=details)


class Client:
    """A small synchronous client for a Constellation deployment.

    The client uses the standard library only, so it is suitable for scripts,
    web applications, workers, and serverless functions without another HTTP
    dependency. A custom ``opener`` can be supplied for tests or specialized
    network environments.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        *,
        timeout: float = 30.0,
        user_agent: str = "constellation-client/0.1.0",
        opener: Opener | None = None,
    ) -> None:
        parsed = urlparse(str(base_url))
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("base_url must be an absolute HTTP(S) URL")
        if timeout <= 0:
            raise ValueError("timeout must be greater than zero")
        self.base_url = str(base_url).rstrip("/")
        self.api_key = api_key
        self.timeout = float(timeout)
        self.user_agent = user_agent
        self._opener = opener or urlopen

    @classmethod
    def from_env(
        cls,
        base_url: str | None = None,
        api_key: str | None = None,
        **kwargs: Any,
    ) -> "Client":
        """Create a client from ``CONSTELLATION_URL`` and ``CONSTELLATION_API_KEY``."""

        return cls(
            base_url or os.getenv("CONSTELLATION_URL", "http://127.0.0.1:4317"),
            api_key if api_key is not None else os.getenv("CONSTELLATION_API_KEY"),
            **kwargs,
        )

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def close(self) -> None:
        """Release client resources.

        Requests use short-lived standard-library connections, so this is a
        no-op today and exists to make lifecycle management consistent with
        clients that use a connection pool.
        """

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        content_type: str | None = None,
        authenticated: bool = True,
    ) -> Any:
        url = f"{self.base_url}/{path.lstrip('/')}"
        headers = {
            "Accept": "application/json",
            "User-Agent": self.user_agent,
        }
        if authenticated and self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if body is not None:
            headers["Content-Type"] = content_type or "application/json"
        request = Request(url, data=body, headers=headers, method=method.upper())

        try:
            with self._opener(request, timeout=self.timeout) as response:
                response_body = response.read()
                status = int(response.getcode())
        except HTTPError as error:
            response_body = error.read()
            message, details = _error_details(response_body)
            raise _api_error(error.code, message, method=method.upper(), url=url, details=details) from error
        except TimeoutError as error:
            raise ConstellationTimeoutError(f"Timed out calling {method.upper()} {url}") from error
        except URLError as error:
            reason = getattr(error, "reason", error)
            if isinstance(reason, TimeoutError):
                raise ConstellationTimeoutError(f"Timed out calling {method.upper()} {url}") from error
            raise ConstellationConnectionError(f"Could not connect to {url}: {reason}") from error
        except OSError as error:
            raise ConstellationConnectionError(f"Could not connect to {url}: {error}") from error

        if not 200 <= status < 300:
            message, details = _error_details(response_body)
            raise _api_error(status, message, method=method.upper(), url=url, details=details)
        return _decode_body(response_body)

    def _json_request(self, method: str, path: str, payload: Any | None = None) -> Any:
        return self._request(
            method,
            path,
            body=None if payload is None else _json_body(payload),
            content_type="application/json; charset=utf-8" if payload is not None else None,
        )

    def health(self) -> Health:
        return Health.from_dict(self._request("GET", "/health", authenticated=False) or {})

    def status(self) -> dict[str, Any]:
        return dict(self._request("GET", "/api/status") or {})

    def models(self) -> dict[str, Any]:
        return dict(self._request("GET", "/api/models") or {})

    def settings(self) -> dict[str, Any]:
        return dict(self._request("GET", "/api/settings") or {})

    get_settings = settings

    def update_settings(
        self,
        settings: Mapping[str, Any],
        *,
        clear_secrets: Sequence[str] = (),
    ) -> dict[str, Any]:
        payload = {
            "settings": dict(settings),
            "clearSecrets": list(clear_secrets),
        }
        return dict(self._json_request("PUT", "/api/settings", payload) or {})

    def preload_models(self) -> dict[str, Any]:
        return dict(self._json_request("POST", "/api/models/preload") or {})

    def query(
        self,
        query: str,
        *,
        top_k: int = 5,
        candidate_k: int = 20,
        rerank: bool = True,
        rerank_top_k: int | None = None,
        min_score: float | None = None,
        filter: str | None = None,
        nprobes: int | None = None,
        refine_factor: int | None = None,
        distance_type: str = "cosine",
        table_name: str | None = None,
        table: str | None = None,
    ) -> QueryResponse:
        payload: dict[str, Any] = {
            "query": _require_text(query, "query"),
            "topK": top_k,
            "candidateK": candidate_k,
            "rerank": rerank,
            "distanceType": distance_type,
        }
        _optional(payload, "rerankTopK", rerank_top_k)
        _optional(payload, "minScore", min_score)
        _optional(payload, "filter", filter)
        _optional(payload, "nprobes", nprobes)
        _optional(payload, "refineFactor", refine_factor)
        _optional(payload, "tableName", table_name if table_name is not None else table)
        return QueryResponse.from_dict(self._json_request("POST", "/api/query", payload) or {})

    search = query

    def create_embeddings(self, inputs: str | Sequence[str]) -> EmbeddingResponse:
        values = [inputs] if isinstance(inputs, str) else list(inputs)
        if not values or any(not str(value).strip() for value in values):
            raise ValueError("inputs must contain at least one non-empty text value")
        response = self._json_request("POST", "/api/embeddings", {"inputs": values}) or {}
        return EmbeddingResponse.from_dict(response)

    embeddings = create_embeddings

    def embed(self, inputs: str | Sequence[str]) -> list[float] | list[list[float]]:
        """Return vectors directly; a single string returns one vector."""

        response = self.create_embeddings(inputs)
        if isinstance(inputs, str):
            return response.vectors[0]
        return response.vectors

    def rerank(
        self,
        query: str,
        documents: Sequence[str | Mapping[str, Any]],
        *,
        top_n: int | None = None,
        return_documents: bool = True,
    ) -> RerankResponse:
        if not documents:
            raise ValueError("documents must contain at least one item")
        payload: dict[str, Any] = {
            "query": _require_text(query, "query"),
            "documents": list(documents),
            "returnDocuments": return_documents,
        }
        _optional(payload, "topN", top_n)
        return RerankResponse.from_dict(self._json_request("POST", "/api/rerank", payload) or {})

    def list_documents(self) -> list[Document]:
        response = self._request("GET", "/api/knowledge") or {}
        return [Document.from_dict(item) for item in response.get("documents", [])]

    documents = list_documents

    def list_tables(self) -> list[str]:
        response = self._request("GET", "/api/tables") or {}
        return [str(value) for value in response.get("tables", [])]

    tables = list_tables

    def ingest_text(
        self,
        title: str,
        text: str,
        *,
        metadata: Mapping[str, Any] | None = None,
        chunk_size: int | None = None,
        overlap: int | None = None,
        table_name: str | None = None,
        table: str | None = None,
    ) -> IngestResult:
        payload: dict[str, Any] = {
            "title": _require_text(title, "title"),
            "text": _require_text(text, "text"),
            "metadata": dict(metadata or {}),
        }
        _optional(payload, "chunkSize", chunk_size)
        _optional(payload, "overlap", overlap)
        _optional(payload, "tableName", table_name if table_name is not None else table)
        return IngestResult.from_dict(self._json_request("POST", "/api/knowledge/manual", payload) or {})

    def upload_file(
        self,
        file: str | Path | bytes | bytearray | BinaryIO,
        *,
        filename: str | None = None,
        title: str | None = None,
        chunk_size: int | None = None,
        overlap: int | None = None,
        table_name: str | None = None,
        table: str | None = None,
    ) -> IngestResult:
        """Upload a PDF, DOCX, Markdown, or TXT file.

        ``file`` may be a path, bytes, or a binary file-like object. File-like
        objects are read from their current position and are not closed.
        """

        close_after = False
        if isinstance(file, (str, Path)):
            path = Path(file)
            stream = path.open("rb")
            close_after = True
            filename = filename or path.name
        elif isinstance(file, (bytes, bytearray)):
            stream = None
            content = bytes(file)
            filename = filename or "document.txt"
        else:
            stream = file
            content = b""
            filename = filename or Path(str(getattr(file, "name", "document.txt"))).name

        try:
            if stream is not None:
                content = stream.read()
            if not isinstance(content, bytes):
                content = bytes(content)
        finally:
            if close_after:
                stream.close()

        fields: dict[str, str] = {}
        if title is not None:
            fields["title"] = title
        if chunk_size is not None:
            fields["chunkSize"] = str(chunk_size)
        if overlap is not None:
            fields["overlap"] = str(overlap)
        if table_name is not None:
            fields["tableName"] = table_name
        elif table is not None:
            fields["table"] = table
        body, content_type = self._multipart(
            fields,
            {"file": (filename or "document.txt", content, "application/octet-stream")},
        )
        return IngestResult.from_dict(self._request("POST", "/api/knowledge/upload", body=body, content_type=content_type) or {})

    @staticmethod
    def _multipart(
        fields: Mapping[str, str],
        files: Mapping[str, tuple[str, bytes, str]],
    ) -> tuple[bytes, str]:
        boundary = f"----ConstellationClient{uuid.uuid4().hex}"
        lines: list[bytes] = []
        for name, value in fields.items():
            lines.extend([
                f"--{boundary}".encode(),
                f'Content-Disposition: form-data; name="{name}"'.encode(),
                b"",
                str(value).encode("utf-8"),
            ])
        for name, (filename, content, content_type) in files.items():
            lines.extend([
                f"--{boundary}".encode(),
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"'.encode(),
                f"Content-Type: {content_type}".encode(),
                b"",
                content,
            ])
        lines.append(f"--{boundary}--".encode())
        return b"\r\n".join(lines) + b"\r\n", f"multipart/form-data; boundary={boundary}"

    def crawl(
        self,
        url: str,
        *,
        max_pages: int | None = None,
        max_depth: int | None = None,
        same_origin: bool = True,
        chunk_size: int | None = None,
        overlap: int | None = None,
        table_name: str | None = None,
        table: str | None = None,
    ) -> CrawlResponse:
        payload: dict[str, Any] = {"url": _require_text(url, "url"), "sameOrigin": same_origin}
        _optional(payload, "maxPages", max_pages)
        _optional(payload, "maxDepth", max_depth)
        _optional(payload, "chunkSize", chunk_size)
        _optional(payload, "overlap", overlap)
        _optional(payload, "tableName", table_name if table_name is not None else table)
        return CrawlResponse.from_dict(self._json_request("POST", "/api/knowledge/crawl", payload) or {})

    def document_chunks(self, document_id: str) -> DocumentChunks:
        document_id = _require_text(document_id, "document_id")
        response = self._request("GET", f"/api/knowledge/{quote(document_id, safe='')}/chunks") or {}
        return DocumentChunks.from_dict(response)

    chunks = document_chunks

    def get_document_text(self, identifier: str) -> DocumentText:
        identifier = _require_text(identifier, "identifier")
        response = self._request("GET", f"/api/knowledge/{quote(identifier, safe='')}") or {}
        return DocumentText.from_dict(response)

    document_text = get_document_text

    def replace_document(
        self,
        identifier: str,
        text: str,
        *,
        title: str | None = None,
        source_type: str | None = None,
        source_uri: str | None = None,
        metadata: Mapping[str, Any] | None = None,
        chunk_size: int | None = None,
        overlap: int | None = None,
        table_name: str | None = None,
        table: str | None = None,
    ) -> IngestResult:
        identifier = _require_text(identifier, "identifier")
        payload: dict[str, Any] = {"text": _require_text(text, "text")}
        _optional(payload, "title", title)
        _optional(payload, "sourceType", source_type)
        _optional(payload, "sourceUri", source_uri)
        if metadata is not None:
            payload["metadata"] = dict(metadata)
        _optional(payload, "chunkSize", chunk_size)
        _optional(payload, "overlap", overlap)
        _optional(payload, "tableName", table_name if table_name is not None else table)
        return IngestResult.from_dict(self._json_request("PUT", f"/api/knowledge/{quote(identifier, safe='')}", payload) or {})

    replace_knowledge = replace_document

    def delete_document(self, document_id: str) -> dict[str, Any]:
        document_id = _require_text(document_id, "document_id")
        return dict(self._request("DELETE", f"/api/knowledge/{quote(document_id, safe='')}") or {})

    def ensure_index(self, *, table_name: str | None = None, table: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        _optional(payload, "tableName", table_name if table_name is not None else table)
        return dict(self._json_request("POST", "/api/index/ensure", payload) or {})

    def list_peers(self) -> list[Peer]:
        response = self._request("GET", "/api/cluster/peers") or {}
        return [Peer.from_dict(item) for item in response.get("peers", [])]

    def add_peer(self, url: str, *, priority: int = 100) -> Peer:
        response = self._json_request("POST", "/api/cluster/peers", {"url": _require_text(url, "url"), "priority": priority}) or {}
        return Peer.from_dict(response.get("peer") or {})

    def sync_peer(self, peer_id: str) -> dict[str, Any]:
        peer_id = _require_text(peer_id, "peer_id")
        return dict(self._json_request("POST", f"/api/cluster/peers/{quote(peer_id, safe='')}/sync") or {})

    def remove_peer(self, peer_id: str) -> dict[str, Any]:
        peer_id = _require_text(peer_id, "peer_id")
        return dict(self._request("DELETE", f"/api/cluster/peers/{quote(peer_id, safe='')}") or {})


class AsyncClient:
    """Asyncio facade over :class:`Client`.

    Calls run in a worker thread so the package remains dependency-free while
    still being safe to use from async web handlers and workers.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._client = Client(*args, **kwargs)

    @classmethod
    def from_env(cls, base_url: str | None = None, api_key: str | None = None, **kwargs: Any) -> "AsyncClient":
        return cls(base_url or os.getenv("CONSTELLATION_URL", "http://127.0.0.1:4317"), api_key if api_key is not None else os.getenv("CONSTELLATION_API_KEY"), **kwargs)

    async def __aenter__(self) -> "AsyncClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await asyncio.to_thread(self._client.close)

    async def health(self) -> Health:
        return await asyncio.to_thread(self._client.health)

    async def status(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._client.status)

    async def models(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._client.models)

    async def settings(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._client.settings)

    get_settings = settings

    async def update_settings(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return await asyncio.to_thread(self._client.update_settings, *args, **kwargs)

    async def preload_models(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._client.preload_models)

    async def query(self, *args: Any, **kwargs: Any) -> QueryResponse:
        return await asyncio.to_thread(self._client.query, *args, **kwargs)

    search = query

    async def create_embeddings(self, *args: Any, **kwargs: Any) -> EmbeddingResponse:
        return await asyncio.to_thread(self._client.create_embeddings, *args, **kwargs)

    embeddings = create_embeddings

    async def embed(self, *args: Any, **kwargs: Any) -> list[float] | list[list[float]]:
        return await asyncio.to_thread(self._client.embed, *args, **kwargs)

    async def rerank(self, *args: Any, **kwargs: Any) -> RerankResponse:
        return await asyncio.to_thread(self._client.rerank, *args, **kwargs)

    async def list_documents(self) -> list[Document]:
        return await asyncio.to_thread(self._client.list_documents)

    documents = list_documents

    async def list_tables(self) -> list[str]:
        return await asyncio.to_thread(self._client.list_tables)

    tables = list_tables

    async def ingest_text(self, *args: Any, **kwargs: Any) -> IngestResult:
        return await asyncio.to_thread(self._client.ingest_text, *args, **kwargs)

    async def upload_file(self, *args: Any, **kwargs: Any) -> IngestResult:
        return await asyncio.to_thread(self._client.upload_file, *args, **kwargs)

    async def crawl(self, *args: Any, **kwargs: Any) -> CrawlResponse:
        return await asyncio.to_thread(self._client.crawl, *args, **kwargs)

    async def document_chunks(self, *args: Any, **kwargs: Any) -> DocumentChunks:
        return await asyncio.to_thread(self._client.document_chunks, *args, **kwargs)

    chunks = document_chunks

    async def get_document_text(self, *args: Any, **kwargs: Any) -> DocumentText:
        return await asyncio.to_thread(self._client.get_document_text, *args, **kwargs)

    document_text = get_document_text

    async def replace_document(self, *args: Any, **kwargs: Any) -> IngestResult:
        return await asyncio.to_thread(self._client.replace_document, *args, **kwargs)

    replace_knowledge = replace_document

    async def delete_document(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return await asyncio.to_thread(self._client.delete_document, *args, **kwargs)

    async def ensure_index(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._client.ensure_index)

    async def list_peers(self) -> list[Peer]:
        return await asyncio.to_thread(self._client.list_peers)

    async def add_peer(self, *args: Any, **kwargs: Any) -> Peer:
        return await asyncio.to_thread(self._client.add_peer, *args, **kwargs)

    async def sync_peer(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return await asyncio.to_thread(self._client.sync_peer, *args, **kwargs)

    async def remove_peer(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return await asyncio.to_thread(self._client.remove_peer, *args, **kwargs)


AsyncConstellationClient = AsyncClient
