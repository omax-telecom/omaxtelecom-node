import { describe, expect, it } from "vitest";
import { OmaxWebhookVerificationError, Webhooks } from "../src/index.js";

// Signed with the official reference library, so this checks we verify real deliveries.
const vector = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  body: '{"type":"sms.message.delivered","sms":{"id":"0198c5f9-52b0-7b1e-8c3d-4e5f6a7b8c9d","to":"38761123456","text":"Zdravo šđč €"},"organization_sso_id":"your-organization"}',
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: "1793869200",
  signature: "v1,4D5hYU/LCj01SlvzwcD5VKgdIeL9K9O1LZIrcFAubKo=",
};
const headers = { "svix-id": vector.id, "svix-timestamp": vector.timestamp, "svix-signature": vector.signature };
const now = Number(vector.timestamp) * 1000;
const webhooks = new Webhooks();

describe("webhooks.verify", () => {
  it("accepts a delivery signed by the reference implementation", () => {
    const event = webhooks.verify(vector.body, headers, vector.secret, { now });
    expect(event.type).toBe("sms.message.delivered");
    if (event.type === "sms.message.delivered") {
      expect(event.sms.to).toBe("38761123456");
    }
  });

  it("accepts a Buffer body, Headers, upper-case names and several signatures", () => {
    const h = new Headers({ ...headers, "Svix-Signature": `v1,AAAA ${vector.signature}` });
    expect(() => webhooks.verify(Buffer.from(vector.body), h, vector.secret, { now })).not.toThrow();
  });

  it("accepts the old secret during rotation", () => {
    expect(() => webhooks.verify(vector.body, headers, ["whsec_bmV3LXNlY3JldC1uZXctc2VjcmV0", vector.secret], { now })).not.toThrow();
  });

  it.each([
    ["a changed body", vector.body.replace("Zdravo", "Zdrav0"), headers, vector.secret, now],
    ["a wrong secret", vector.body, headers, "whsec_d3Jvbmctc2VjcmV0LXdyb25nLXNlY3JldA==", now],
    ["an old timestamp", vector.body, headers, vector.secret, now + 301_000],
    ["missing headers", vector.body, { "svix-id": vector.id }, vector.secret, now],
  ])("rejects %s", (_name, body, h, secret, time) => {
    expect(() => webhooks.verify(body, h as never, secret, { now: time })).toThrow(OmaxWebhookVerificationError);
  });
});

describe("webhooks.sign", () => {
  it("signs payloads that verify, for testing your handler", () => {
    const { body, headers: signed } = webhooks.sign(
      { type: "bappy.usage.depleted", usage: { threshold_percent: 100 } } as Record<string, unknown>,
      vector.secret,
    );
    const event = webhooks.verify(body, signed, vector.secret);
    expect(event.type).toBe("bappy.usage.depleted");
  });
});
