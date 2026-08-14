"""Public API for the Constellation Python client."""

from .client import AsyncClient, AsyncConstellationClient, Client
from .exceptions import (
    AuthenticationError,
    ConstellationAPIError,
    ConstellationConnectionError,
    ConstellationError,
    ConstellationTimeoutError,
    NotFoundError,
)
from .models import (
    Chunk,
    CrawlResponse,
    Document,
    DocumentChunks,
    DocumentText,
    EmbeddingResponse,
    Health,
    IngestResult,
    Peer,
    QueryResponse,
    QueryResult,
    RerankResponse,
    RerankResult,
)

__all__ = [
    "AsyncClient",
    "AsyncConstellationClient",
    "AuthenticationError",
    "Chunk",
    "Client",
    "ConstellationAPIError",
    "ConstellationConnectionError",
    "ConstellationError",
    "ConstellationTimeoutError",
    "CrawlResponse",
    "Document",
    "DocumentChunks",
    "DocumentText",
    "EmbeddingResponse",
    "Health",
    "IngestResult",
    "NotFoundError",
    "Peer",
    "QueryResponse",
    "QueryResult",
    "RerankResponse",
    "RerankResult",
]

__version__ = "0.1.0"
