"""Exceptions raised by the Constellation Python client."""

from __future__ import annotations

from typing import Any


class ConstellationError(Exception):
    """Base class for all client errors."""


class ConstellationConnectionError(ConstellationError):
    """The client could not connect to the Constellation server."""


class ConstellationTimeoutError(ConstellationConnectionError):
    """The server did not respond before the configured timeout."""


class ConstellationAPIError(ConstellationError):
    """The server returned a non-success HTTP response."""

    def __init__(
        self,
        status_code: int,
        message: str,
        *,
        method: str = "",
        url: str = "",
        details: Any = None,
    ) -> None:
        self.status_code = status_code
        self.message = message
        self.method = method
        self.url = url
        self.details = details
        super().__init__(self._format_message())

    def _format_message(self) -> str:
        prefix = f"{self.status_code}"
        if self.method and self.url:
            prefix = f"{prefix} for {self.method} {self.url}"
        return f"Constellation API error ({prefix}): {self.message}"


class AuthenticationError(ConstellationAPIError):
    """The API key was missing, invalid, or rejected."""


class NotFoundError(ConstellationAPIError):
    """The requested Constellation resource does not exist."""
