import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { OmaxWebhookVerificationError } from "./core/errors.js";
import type { webhooks as WebhookOperations } from "./generated/webhooks.js";

/** Every event type, for example `"sms.message.delivered"`. */
export type WebhookEventType = keyof WebhookOperations;

/** The body of one event type. */
export type WebhookEventOf<K extends WebhookEventType> =
  WebhookOperations[K]["post"]["requestBody"]["content"]["application/json"];

/** Any event. Narrow it with `event.type`. */
export type WebhookEvent = { [K in WebhookEventType]: WebhookEventOf<K> }[WebhookEventType];

export type WebhookHeaders =
  | Headers
  | Record<string, string | string[] | undefined>;

export type VerifyOptions = {
  /** Allowed difference between the request timestamp and your clock, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Current time in milliseconds (for tests). */
  now?: number;
};

const header = (headers: WebhookHeaders, name: string): string | null => {
  if (headers instanceof Headers) return headers.get(name);
  const value = headers[name] ?? headers[name.toLowerCase()] ??
    Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
};

const toText = (body: string | Uint8Array): string =>
  typeof body === "string" ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");

const keyOf = (secret: string): Buffer => Buffer.from(secret.replace(/^whsec_/, ""), "base64");

const signature = (secret: string, id: string, timestamp: string, body: string): string =>
  createHmac("sha256", keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");

/** Webhook helpers: https://developer.omaxtelecom.com/webhooks */
export class Webhooks {
  /**
   * Verify a webhook request and return its event. Pass the **raw** body
   * (string or Buffer), the request headers and your endpoint's signing secret.
   * Throws `OmaxWebhookVerificationError` when the request is not genuine.
   * To accept two secrets while you rotate, pass both: `[newSecret, oldSecret]`.
   */
  verify(rawBody: string | Uint8Array, headers: WebhookHeaders, secret: string | string[], options: VerifyOptions = {}): WebhookEvent {
    const id = header(headers, "svix-id");
    const timestamp = header(headers, "svix-timestamp");
    const signatures = header(headers, "svix-signature");
    if (!id || !timestamp || !signatures) {
      throw new OmaxWebhookVerificationError("Missing svix-id, svix-timestamp or svix-signature header");
    }

    const seconds = Number(timestamp);
    const now = (options.now ?? Date.now()) / 1000;
    const tolerance = options.toleranceSeconds ?? 300;
    if (!Number.isInteger(seconds) || seconds <= 0 || Math.abs(now - seconds) > tolerance) {
      throw new OmaxWebhookVerificationError("Webhook timestamp is outside the allowed window");
    }

    const body = toText(rawBody);
    const secrets = Array.isArray(secret) ? secret : [secret];
    const received = signatures
      .split(" ")
      .map((entry) => entry.split(","))
      .filter(([version, value]) => version === "v1" && value)
      .map(([, value]) => Buffer.from(value!));

    const valid = secrets.some((s) => {
      const expected = Buffer.from(signature(s, id, timestamp, body));
      return received.some((r) => r.length === expected.length && timingSafeEqual(r, expected));
    });
    if (!valid) {
      throw new OmaxWebhookVerificationError("Webhook signature does not match");
    }

    try {
      return JSON.parse(body) as WebhookEvent;
    } catch (error) {
      throw new OmaxWebhookVerificationError("Webhook body is not valid JSON", { cause: error });
    }
  }

  /**
   * Sign a payload like OmaxTelecom does, to test your webhook handler.
   * Returns the body and the headers to send with it.
   */
  sign(
    payload: WebhookEvent | Record<string, unknown> | string,
    secret: string,
    options: { id?: string; timestamp?: number } = {},
  ): { body: string; headers: Record<"svix-id" | "svix-timestamp" | "svix-signature", string> } {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const id = options.id ?? `msg_${randomUUID().replace(/-/g, "")}`;
    const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
    return {
      body,
      headers: {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature(secret, id, timestamp, body)}`,
      },
    };
  }
}
