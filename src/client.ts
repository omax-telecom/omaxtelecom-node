import { DEFAULT_TOKEN_URL, TokenManager } from "./core/auth.js";
import { OmaxError } from "./core/errors.js";
import { HttpClient, SDK_VERSION } from "./core/http.js";
import { Bappy, BAPPY_BASE_URL } from "./resources/bappy.js";
import { PhoneNumbers, PHONE_NUMBERS_BASE_URL } from "./resources/phone-numbers.js";
import { Otp, Sms, SMS_BASE_URL } from "./resources/sms.js";
import { Webhooks } from "./webhooks.js";

export type OmaxOptions = {
  /** Client ID from the Console. Defaults to the `OMAX_CLIENT_ID` environment variable. */
  clientId?: string;
  /** Client secret from the Console. Defaults to `OMAX_CLIENT_SECRET`. */
  clientSecret?: string;
  /** Use your own access token instead of client credentials. */
  accessToken?: string;
  /** Timeout of one attempt, in milliseconds. Default 30,000. */
  timeoutMs?: number;
  /** How many times a failed request may be retried. Default 2. */
  maxRetries?: number;
  /** Your own fetch (proxies, tests). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Override API addresses (for example a proxy). */
  baseUrls?: Partial<{ sms: string; bappy: string; phoneNumbers: string; token: string }>;
};

const env = (name: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[name] : undefined;

/**
 * OmaxTelecom API client.
 *
 * ```ts
 * const omax = new Omax({ clientId, clientSecret });
 * await omax.sms.messages.send({ from: "ACME", to: "+38765123456", text: "Hello" });
 * ```
 */
export class Omax {
  /** SMS API. */
  readonly sms: Sms;
  /** OTP API (one-time codes by SMS). */
  readonly otp: Otp;
  /** Bappy API (eSIM and SIM data through Links). */
  readonly bappy: Bappy;
  /** Phone Numbers API. */
  readonly phoneNumbers: PhoneNumbers;
  /** Webhook signature verification and test signing. */
  readonly webhooks: Webhooks;

  constructor(options: OmaxOptions = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new OmaxError("No fetch available: use Node.js 18 or newer, or pass `fetch` in the options.");
    }

    const timeoutMs = options.timeoutMs ?? 30_000;
    const clientId = options.clientId ?? env("OMAX_CLIENT_ID");
    const clientSecret = options.clientSecret ?? env("OMAX_CLIENT_SECRET");
    const accessToken = options.accessToken ?? null;

    if (!accessToken && (!clientId || !clientSecret)) {
      throw new OmaxError(
        "Missing credentials: pass clientId and clientSecret (or set OMAX_CLIENT_ID and OMAX_CLIENT_SECRET), or pass accessToken.",
      );
    }

    const tokens = accessToken
      ? null
      : new TokenManager({
          clientId: clientId!,
          clientSecret: clientSecret!,
          tokenUrl: options.baseUrls?.token ?? DEFAULT_TOKEN_URL,
          fetch: fetchImpl,
          timeoutMs,
        });

    const http = new HttpClient({
      tokens,
      accessToken,
      fetch: fetchImpl,
      timeoutMs,
      maxRetries: options.maxRetries ?? 2,
      userAgent: `omaxtelecom-node/${SDK_VERSION} node/${typeof process !== "undefined" ? process.version : "unknown"}`,
    });

    const urls = options.baseUrls ?? {};
    this.sms = new Sms(http, urls.sms ?? SMS_BASE_URL);
    this.otp = new Otp(http, urls.sms ?? SMS_BASE_URL);
    this.bappy = new Bappy(http, urls.bappy ?? BAPPY_BASE_URL);
    this.phoneNumbers = new PhoneNumbers(http, urls.phoneNumbers ?? PHONE_NUMBERS_BASE_URL);
    this.webhooks = new Webhooks();
  }
}
