import { randomUUID } from "node:crypto";
import type { TokenManager } from "./auth.js";
import { OmaxApiError, OmaxConnectionError, OmaxError, OmaxTimeoutError } from "./errors.js";

export const SDK_VERSION = "0.1.0";

/** Options you can pass as the last argument of any method. */
export type RequestOptions = {
  /** Idempotency key for this call. Generated for you when the endpoint uses one; set it to reuse your own key. */
  idempotencyKey?: string;
  /** Timeout of one attempt, in milliseconds. */
  timeoutMs?: number;
  /** How many times a failed request may be retried (see the README for which ones). */
  maxRetries?: number;
  /** Abort the request (and its retries). */
  signal?: AbortSignal;
  /** Extra headers. */
  headers?: Record<string, string>;
};

/** Parsed API response: the `data` of the envelope plus `meta` and headers. */
export type ApiResponse<T> = {
  data: T;
  meta: Record<string, unknown> | null;
  status: number;
  headers: Headers;
};

export type QueryValue = string | number | boolean | null | undefined | QueryValue[] | { [key: string]: QueryValue };
export type Query = Record<string, QueryValue>;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequest = {
  method: Method;
  baseUrl: string;
  path: string;
  query?: Query;
  body?: unknown;
  /** multipart/form-data body (file uploads). */
  form?: FormData;
  /** `required`/`optional`: send an Idempotency-Key, generated unless one is given. */
  idempotency?: "required" | "optional";
  /** No access token (health endpoints). */
  public?: boolean;
  options?: RequestOptions;
};

export type HttpConfig = {
  tokens: TokenManager | null;
  accessToken: string | null;
  fetch: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  userAgent: string;
};

const RETRYABLE_STATUS_GET = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_SECONDS = 60;

export class HttpClient {
  constructor(private readonly config: HttpConfig) {}

  async request<T>(req: HttpRequest): Promise<ApiResponse<T>> {
    const opts = req.options ?? {};
    const maxRetries = opts.maxRetries ?? this.config.maxRetries;
    const idempotencyKey = req.idempotency ? (opts.idempotencyKey ?? randomUUID()) : opts.idempotencyKey;
    const url = buildUrl(req.baseUrl, req.path, req.query);
    let refreshedToken = false;

    for (let attempt = 0; ; attempt++) {
      const headers = await this.headers(req, opts, idempotencyKey);
      let response: Response;
      try {
        response = await this.config.fetch(url, {
          method: req.method,
          headers,
          body: req.form ?? (req.body === undefined ? undefined : JSON.stringify(req.body)),
          signal: anySignal(opts.signal, AbortSignal.timeout(opts.timeoutMs ?? this.config.timeoutMs)),
        });
      } catch (error) {
        if (opts.signal?.aborted) throw new OmaxError("Request aborted", { cause: error });
        const timedOut = (error as Error)?.name === "TimeoutError";
        // Without a response nobody knows if the server acted: only safe requests are retried.
        const safe = req.method === "GET" || idempotencyKey !== undefined;
        if (safe && attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        const message = timedOut ? `${req.method} ${url} timed out` : `${req.method} ${url} failed: ${(error as Error).message}`;
        throw timedOut ? new OmaxTimeoutError(message, { cause: error }) : new OmaxConnectionError(message, { cause: error });
      }

      const body = await parseBody(response);

      if (response.ok) {
        return unwrap<T>(body, response);
      }

      const error = toApiError(response, body);

      if (response.status === 401 && this.config.tokens && !refreshedToken && !req.public) {
        this.config.tokens.invalidate();
        refreshedToken = true;
        continue;
      }

      if (attempt < maxRetries && this.shouldRetry(req.method, error)) {
        const wait = error.retryAfter !== null ? error.retryAfter * 1000 : backoff(attempt);
        if (error.retryAfter === null || error.retryAfter <= MAX_RETRY_AFTER_SECONDS) {
          await sleep(wait);
          continue;
        }
      }

      throw error;
    }
  }

  private shouldRetry(method: Method, error: OmaxApiError): boolean {
    // Rate limited or still processing the same key: the request was not carried out.
    if (error.status === 429) return true;
    if (error.status === 409 && error.code === "IDEMPOTENCY_IN_PROGRESS") return true;
    // A failed write may or may not have happened, so only reads are retried on server errors.
    return method === "GET" && RETRYABLE_STATUS_GET.has(error.status);
  }

  private async headers(req: HttpRequest, opts: RequestOptions, idempotencyKey: string | undefined): Promise<Headers> {
    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": this.config.userAgent,
    });
    if (req.body !== undefined && !req.form) headers.set("Content-Type", "application/json");
    if (idempotencyKey !== undefined) headers.set("Idempotency-Key", idempotencyKey);
    if (!req.public) {
      const token = this.config.accessToken ?? (await this.config.tokens!.getToken());
      headers.set("Authorization", `Bearer ${token}`);
    }
    for (const [name, value] of Object.entries(opts.headers ?? {})) headers.set(name, value);
    return headers;
  }
}

export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(baseUrl.replace(/\/+$/, "") + path);
  const append = (key: string, value: QueryValue): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) append(`${key}[]`, item);
    } else if (typeof value === "object") {
      for (const [sub, item] of Object.entries(value)) append(`${key}[${sub}]`, item);
    } else {
      url.searchParams.append(key, String(value));
    }
  };
  for (const [key, value] of Object.entries(query ?? {})) append(key, value);
  return url.toString();
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** `{ success, data, meta }` envelopes become `data` + `meta`; other bodies are returned as is. */
function unwrap<T>(body: unknown, response: Response): ApiResponse<T> {
  const isEnvelope = isRecord(body) && typeof body.success === "boolean" && "data" in body;
  return {
    data: (isEnvelope ? body.data : body) as T,
    meta: isEnvelope && isRecord(body.meta) ? body.meta : null,
    status: response.status,
    headers: response.headers,
  };
}

function toApiError(response: Response, body: unknown): OmaxApiError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : isRecord(body) ? body : {};
  const retryAfterHeader = response.headers.get("Retry-After");
  const retryAfter = retryAfterHeader !== null && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : null;

  return new OmaxApiError({
    status: response.status,
    code: typeof error.code === "string" ? error.code : `HTTP_${response.status}`,
    message:
      typeof error.message === "string"
        ? error.message
        : typeof body === "string" && body.length < 300
          ? body
          : response.statusText || "Request failed",
    requestId: (typeof error.request_id === "string" ? error.request_id : null) ?? response.headers.get("X-Request-Id"),
    fields: isRecord(error.fields) ? (error.fields as Record<string, string[]>) : null,
    details: error.details ?? null,
    retryAfter,
    body,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function backoff(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base / 2 + Math.random() * (base / 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const active = signals.filter((s): s is AbortSignal => s !== undefined);
  if (active.length === 1) return active[0]!;
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
