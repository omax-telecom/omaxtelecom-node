/** Base class of every error thrown by the SDK. */
export class OmaxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The API answered with an error. Branch on `code` (for example
 * `INSUFFICIENT_BALANCE`) and `status`, never on `message`.
 */
export class OmaxApiError extends OmaxError {
  /** HTTP status code. */
  readonly status: number;
  /** Error code from the API, for example `VALIDATION_FAILED`. */
  readonly code: string;
  /** Request ID to quote to support, when the API sent one. */
  readonly requestId: string | null;
  /** Invalid fields and their messages, for validation errors. */
  readonly fields: Record<string, string[]> | null;
  /** Extra details sent with the error. */
  readonly details: unknown;
  /** Seconds to wait before retrying, from `Retry-After`. */
  readonly retryAfter: number | null;
  /** The full parsed response body. */
  readonly body: unknown;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    requestId?: string | null;
    fields?: Record<string, string[]> | null;
    details?: unknown;
    retryAfter?: number | null;
    body?: unknown;
  }) {
    super(`${init.code}: ${init.message}`);
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId ?? null;
    this.fields = init.fields ?? null;
    this.details = init.details ?? null;
    this.retryAfter = init.retryAfter ?? null;
    this.body = init.body;
  }
}

/** The client ID or secret was rejected by the token endpoint. */
export class OmaxAuthenticationError extends OmaxError {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** No response: network failure, DNS, TLS or a closed connection. */
export class OmaxConnectionError extends OmaxError {}

/** No response within the timeout. */
export class OmaxTimeoutError extends OmaxConnectionError {}

/** A webhook request failed signature or timestamp verification. */
export class OmaxWebhookVerificationError extends OmaxError {}
