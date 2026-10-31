import { describe, expect, it, vi } from "vitest";
import { Omax, OmaxApiError, OmaxAuthenticationError, OmaxConnectionError, OmaxError } from "../src/index.js";
import { buildUrl } from "../src/core/http.js";
import { fail, fakeApi, ok } from "./helpers.js";

describe("credentials and token", () => {
  it("needs credentials", () => {
    const old = { ...process.env };
    delete process.env.OMAX_CLIENT_ID;
    delete process.env.OMAX_CLIENT_SECRET;
    expect(() => new Omax({ fetch: globalThis.fetch })).toThrow(OmaxError);
    process.env = old;
  });

  it("gets one token for many calls and sends it as Bearer", async () => {
    const api = fakeApi([ok({ balance: "1" }), ok({ balance: "2" }), ok({ balance: "3" })]);
    const omax = api.client();
    await Promise.all([omax.sms.wallet(), omax.sms.wallet(), omax.sms.wallet()]);

    expect(api.tokenCalls).toHaveLength(1);
    expect(String(api.tokenCalls[0]!.body)).toContain("grant_type=client_credentials");
    expect(api.calls.every((c) => c.headers.get("Authorization") === "Bearer token-1")).toBe(true);
  });

  it("gets a new token once after a 401", async () => {
    const api = fakeApi([fail(401, "UNAUTHORIZED"), ok({ balance: "1" })]);
    const wallet = await api.client().sms.wallet();

    expect(wallet).toEqual({ balance: "1" });
    expect(api.tokenCalls).toHaveLength(2);
    expect(api.calls[1]!.headers.get("Authorization")).toBe("Bearer token-2");
  });

  it("reports a rejected client secret", async () => {
    const api = fakeApi([], [{ status: 401, body: { error: "unauthorized_client", error_description: "Invalid client credentials" } }]);
    await expect(api.client().sms.wallet()).rejects.toThrow(OmaxAuthenticationError);
  });

  it("uses a given access token without the token endpoint", async () => {
    const api = fakeApi([ok({})]);
    await api.client({ clientId: undefined, clientSecret: undefined, accessToken: "mine" }).sms.me();
    expect(api.tokenCalls).toHaveLength(0);
    expect(api.calls[0]!.headers.get("Authorization")).toBe("Bearer mine");
  });

  it("sends no token to health endpoints", async () => {
    const api = fakeApi([ok({ status: "ok" })]);
    await api.client().sms.health();
    expect(api.calls[0]!.headers.has("Authorization")).toBe(false);
    expect(api.tokenCalls).toHaveLength(0);
  });
});

describe("errors", () => {
  it("turns an error envelope into OmaxApiError", async () => {
    const api = fakeApi([
      fail(422, "VALIDATION_FAILED", { request_id: "req-1", fields: { to: ["The to field is required."] }, details: { x: 1 } }),
    ]);
    const error = await api.client().sms.messages.send({ from: "ACME", to: "", text: "Hi" } as never).catch((e) => e);

    expect(error).toBeInstanceOf(OmaxApiError);
    expect(error).toMatchObject({ status: 422, code: "VALIDATION_FAILED", requestId: "req-1", details: { x: 1 } });
    expect(error.fields).toEqual({ to: ["The to field is required."] });
  });

  it("falls back to HTTP_<status> and X-Request-Id", async () => {
    const api = fakeApi([{ status: 500, body: "oops", headers: { "X-Request-Id": "abc" } }]);
    const error = await api.client({ maxRetries: 0 }).sms.wallet().catch((e) => e);
    expect(error).toMatchObject({ code: "HTTP_500", requestId: "abc" });
  });
});

describe("retries", () => {
  it("retries a rate-limited send with the same Idempotency-Key", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const api = fakeApi([fail(429, "RATE_LIMITED", {}, { "Retry-After": "1" }), ok({ id: "m1" })]);
    const promise = api.client().sms.messages.send({ from: "ACME", to: "38761123456", text: "Hi" } as never);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ id: "m1" });
    vi.useRealTimers();

    const keys = api.calls.map((c) => c.headers.get("Idempotency-Key"));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("uses your own Idempotency-Key", async () => {
    const api = fakeApi([ok({ id: "m1" })]);
    await api.client().sms.messages.send({ from: "A", to: "1", text: "x" } as never, { idempotencyKey: "order-42" });
    expect(api.calls[0]!.headers.get("Idempotency-Key")).toBe("order-42");
  });

  it("does not retry a send after a 503 (the outcome is unknown)", async () => {
    const api = fakeApi([fail(503, "SMS_SERVICE_UNAVAILABLE"), ok({})]);
    await expect(api.client().sms.messages.send({ from: "A", to: "1", text: "x" } as never)).rejects.toMatchObject({ status: 503 });
    expect(api.calls).toHaveLength(1);
  });

  it("retries a read after a 503", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const api = fakeApi([fail(503, "SMS_SERVICE_UNAVAILABLE"), ok({ balance: "5" })]);
    const promise = api.client().sms.wallet();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ balance: "5" });
    vi.useRealTimers();
    expect(api.calls).toHaveLength(2);
  });

  it("retries an idempotent write after a lost connection, but not a Bappy Link creation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const api = fakeApi([new TypeError("socket hang up"), ok({ id: "m1" }), new TypeError("socket hang up")]);
    const omax = api.client();
    const send = omax.sms.messages.send({ from: "A", to: "1", text: "x" } as never);
    await vi.runAllTimersAsync();
    await expect(send).resolves.toEqual({ id: "m1" });

    await expect(omax.bappy.links.create({ plan_id: "p" })).rejects.toBeInstanceOf(OmaxConnectionError);
    vi.useRealTimers();
    expect(api.calls).toHaveLength(3);
  });

  it("stops after maxRetries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const api = fakeApi([fail(429, "RATE_LIMITED"), fail(429, "RATE_LIMITED"), fail(429, "RATE_LIMITED")]);
    const promise = api.client({ maxRetries: 2 }).sms.wallet().catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await promise).toMatchObject({ status: 429 });
    vi.useRealTimers();
    expect(api.calls).toHaveLength(3);
  });
});

describe("query strings", () => {
  it("skips empty values and encodes arrays and objects", () => {
    const url = buildUrl("https://api.example.com/x/", "/links", {
      status: "active",
      search: undefined,
      page: 2,
      ids: ["a", "b"],
      metadata: { customer: "c-1" },
    });
    expect(url).toBe("https://api.example.com/x/links?status=active&page=2&ids%5B%5D=a&ids%5B%5D=b&metadata%5Bcustomer%5D=c-1");
  });
});
