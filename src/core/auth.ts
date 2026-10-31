import { OmaxAuthenticationError, OmaxConnectionError } from "./errors.js";

export const DEFAULT_TOKEN_URL = "https://api.omaxtelecom.com/auth/token";

/** Renew this many milliseconds before the token expires. */
const EXPIRY_MARGIN_MS = 30_000;

type Cached = { token: string; expiresAt: number };

/**
 * OAuth 2.0 client credentials. Keeps the token in memory, renews it shortly
 * before it expires, and shares one request when many calls need a token at once.
 */
export class TokenManager {
  private cached: Cached | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      tokenUrl: string;
      fetch: typeof fetch;
      timeoutMs: number;
    },
  ) {}

  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt - EXPIRY_MARGIN_MS) {
      return this.cached.token;
    }
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Forget the token, for example after a 401. */
  invalidate(): void {
    this.cached = null;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    });

    let response: Response;
    try {
      response = await this.options.fetch(this.options.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw new OmaxConnectionError(`Could not reach the token endpoint: ${(error as Error).message}`, { cause: error });
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || typeof payload?.access_token !== "string") {
      const reason =
        (payload?.error_description as string | undefined) ?? (payload?.error as string | undefined) ?? `HTTP ${response.status}`;
      throw new OmaxAuthenticationError(`Could not get an access token: ${reason}`, response.status, payload);
    }

    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 300;
    this.cached = { token: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return this.cached.token;
  }
}
