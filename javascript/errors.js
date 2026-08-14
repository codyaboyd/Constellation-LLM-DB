/** Base class for all Constellation client errors. */
export class ConstellationError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ConstellationError";
  }
}

/** The request could not reach the Constellation server. */
export class ConstellationConnectionError extends ConstellationError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ConstellationConnectionError";
  }
}

/** The request exceeded the configured timeout. */
export class ConstellationTimeoutError extends ConstellationConnectionError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ConstellationTimeoutError";
  }
}

/** The server returned a non-success HTTP response. */
export class ConstellationAPIError extends ConstellationError {
  constructor(status, message, { method = "", url = "", details = null } = {}) {
    const location = method && url ? ` for ${method.toUpperCase()} ${url}` : "";
    super(`Constellation API error (${status}${location}): ${message}`);
    this.name = "ConstellationAPIError";
    this.status = status;
    this.statusCode = status;
    this.message = message;
    this.method = method.toUpperCase();
    this.url = url;
    this.details = details;
  }
}

/** The API key was missing, invalid, or rejected. */
export class AuthenticationError extends ConstellationAPIError {
  constructor(status, message, options = {}) {
    super(status, message, options);
    this.name = "AuthenticationError";
  }
}

/** The requested resource does not exist. */
export class NotFoundError extends ConstellationAPIError {
  constructor(status, message, options = {}) {
    super(status, message, options);
    this.name = "NotFoundError";
  }
}
