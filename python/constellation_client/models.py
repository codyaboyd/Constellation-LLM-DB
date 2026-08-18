"""Typed response models for the Constellation API."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Mapping


def _metadata(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return dict(decoded) if isinstance(decoded, Mapping) else {}
    return {}


def _number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _integer(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True, slots=True)
class Health:
    ok: bool
    role: str

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Health":
        return cls(ok=bool(value.get("ok")), role=str(value.get("role") or ""))


@dataclass(frozen=True, slots=True)
class Document:
    id: str
    title: str
    source_type: str
    table_name: str = "knowledge_chunks"
    source_uri: str = ""
    sha256: str | None = None
    chunk_count: int = 0
    status: str | None = None
    origin_node: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    deleted_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Document":
        return cls(
            id=str(value.get("id") or ""),
            title=str(value.get("title") or ""),
            table_name=str(value.get("table_name") or value.get("tableName") or "knowledge_chunks"),
            source_type=str(value.get("source_type") or value.get("sourceType") or ""),
            source_uri=str(value.get("source_uri") or value.get("sourceUri") or ""),
            sha256=value.get("sha256"),
            chunk_count=int(value.get("chunk_count") or value.get("chunkCount") or 0),
            status=value.get("status"),
            origin_node=value.get("origin_node") or value.get("originNode"),
            metadata=_metadata(value.get("metadata_json", value.get("metadata"))),
            created_at=value.get("created_at") or value.get("createdAt"),
            updated_at=value.get("updated_at") or value.get("updatedAt"),
            deleted_at=value.get("deleted_at") or value.get("deletedAt"),
            raw=dict(value),
        )


@dataclass(frozen=True, slots=True)
class QueryResult:
    id: str
    document_id: str
    chunk_index: int
    text: str
    title: str
    source_type: str
    source_uri: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    vector_score: float | None = None
    rerank_score: float | None = None
    original_rank: int | None = None
    distance: float | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "QueryResult":
        return cls(
            id=str(value.get("id") or ""),
            document_id=str(value.get("document_id") or value.get("documentId") or ""),
            chunk_index=int(value.get("chunk_index") or value.get("chunkIndex") or 0),
            text=str(value.get("text") or ""),
            title=str(value.get("title") or ""),
            source_type=str(value.get("source_type") or value.get("sourceType") or ""),
            source_uri=str(value.get("source_uri") or value.get("sourceUri") or ""),
            metadata=_metadata(value.get("metadata_json", value.get("metadata"))),
            vector_score=_number(value.get("vector_score", value.get("vectorScore"))),
            rerank_score=_number(value.get("rerank_score", value.get("rerankScore"))),
            original_rank=_integer(value.get("original_rank", value.get("originalRank"))),
            distance=_number(value.get("_distance", value.get("distance"))),
            raw=dict(value),
        )


@dataclass(frozen=True, slots=True)
class QueryResponse:
    query: str
    results: list[QueryResult]
    table_name: str = "knowledge_chunks"

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "QueryResponse":
        return cls(
            query=str(value.get("query") or ""),
            table_name=str(value.get("table_name") or value.get("tableName") or value.get("table") or "knowledge_chunks"),
            results=[QueryResult.from_dict(item) for item in value.get("results", [])],
        )


@dataclass(frozen=True, slots=True)
class EmbeddingResponse:
    model: dict[str, Any]
    vectors: list[list[float]]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "EmbeddingResponse":
        return cls(
            model=dict(value.get("model") or {}),
            vectors=[[float(number) for number in vector] for vector in value.get("vectors", [])],
        )


@dataclass(frozen=True, slots=True)
class RerankResult:
    index: int
    relevance_score: float
    document: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "RerankResult":
        document = value.get("document")
        return cls(
            index=int(value.get("index") or 0),
            relevance_score=float(value.get("relevance_score") or value.get("relevanceScore") or 0),
            document=dict(document) if isinstance(document, Mapping) else None,
        )


@dataclass(frozen=True, slots=True)
class RerankResponse:
    model: str | None
    local: bool | None
    results: list[RerankResult]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "RerankResponse":
        return cls(
            model=value.get("model"),
            local=value.get("local"),
            results=[RerankResult.from_dict(item) for item in value.get("results", [])],
        )


@dataclass(frozen=True, slots=True)
class IngestResult:
    document: Document
    chunks: int
    replicated_via_gateway: bool = False

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "IngestResult":
        return cls(
            document=Document.from_dict(value.get("document") or {}),
            chunks=int(value.get("chunks") or 0),
            replicated_via_gateway=bool(value.get("replicatedViaGateway")),
        )


@dataclass(frozen=True, slots=True)
class CrawlResponse:
    pages: int
    results: list[IngestResult]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "CrawlResponse":
        return cls(
            pages=int(value.get("pages") or 0),
            results=[IngestResult.from_dict(item) for item in value.get("results", [])],
        )


@dataclass(frozen=True, slots=True)
class Chunk:
    id: str
    document_id: str
    chunk_index: int
    text: str

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Chunk":
        return cls(
            id=str(value.get("id") or ""),
            document_id=str(value.get("document_id") or value.get("documentId") or ""),
            chunk_index=int(value.get("chunk_index") or value.get("chunkIndex") or 0),
            text=str(value.get("text") or ""),
        )


@dataclass(frozen=True, slots=True)
class DocumentChunks:
    document: dict[str, Any]
    chunks: list[Chunk]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "DocumentChunks":
        return cls(
            document=dict(value.get("document") or {}),
            chunks=[Chunk.from_dict(item) for item in value.get("chunks", [])],
        )


@dataclass(frozen=True, slots=True)
class DocumentText:
    document: Document
    text: str
    raw: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "DocumentText":
        return cls(
            document=Document.from_dict(value.get("document") or {}),
            text=str(value.get("text") or ""),
            raw=dict(value),
        )


@dataclass(frozen=True, slots=True)
class Peer:
    node_id: str
    url: str
    reachable: bool | None = None
    role: str | None = None
    priority: int | None = None
    capabilities: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Peer":
        return cls(
            node_id=str(value.get("node_id") or value.get("nodeId") or ""),
            url=str(value.get("url") or ""),
            reachable=value.get("reachable"),
            role=value.get("role"),
            priority=value.get("priority"),
            capabilities=dict(value.get("capabilities") or {}),
            raw=dict(value),
        )
