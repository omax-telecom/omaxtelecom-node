# OmaxTelecom Node.js SDK

The official Node.js library for the [OmaxTelecom APIs](https://developer.omaxtelecom.com): SMS, OTP, Bappy (eSIM), Phone Numbers and webhooks.

- Gets and renews the access token for you.
- Sends an `Idempotency-Key` where the API uses one, so a retried call never sends an SMS or buys a number twice.
- Retries safely on rate limits and lost connections.
- Pages through lists with `for await`.
- Verifies webhook signatures and gives you typed events.
- Fully typed, from the published OpenAPI documents. No runtime dependencies.

Requires Node.js 18 or newer.

```bash
npm install @omaxtelecom/sdk
```

## Quick start

Create API credentials in the [Console](https://console.omaxtelecom.com) and keep them on your server.

```ts
import { Omax } from "@omaxtelecom/sdk";

const omax = new Omax({
  clientId: process.env.OMAX_CLIENT_ID,
  clientSecret: process.env.OMAX_CLIENT_SECRET,
});

const message = await omax.sms.messages.send({
  from: "ACME",
  to: "+38765123456",
  text: "Your order has shipped.",
});
console.log(message.id, message.status);
```

`new Omax()` without options reads `OMAX_CLIENT_ID` and `OMAX_CLIENT_SECRET` from the environment.

## SMS and OTP

```ts
// Bulk: one text to up to 10,000 numbers
const batch = await omax.sms.messages.sendBulk({ from: "ACME", text: "Sale today", to: ["+38765123456", "+38766123456"] });

// Status of one message
const sms = await omax.sms.messages.get(message.id);

// Every delivered message, page after page
for await (const m of await omax.sms.messages.list({ status: "delivered" })) {
  console.log(m.id, m.to);
}

// Balance, prices, sender IDs
await omax.sms.wallet();
await omax.sms.senderIds.request({ name: "ACME", use_case: "Order notifications" });

// One-time codes
const { verification_id } = await omax.otp.send({ from: "ACME", to: "+38765123456" });
const result = await omax.otp.verify({ verification_id, code: "123456" });
```

## Bappy (eSIM)

```ts
const link = await omax.bappy.links.create({ plan_id: "…", name: "Trip to Italy", metadata: { customer_id: "c-1042" } });
await omax.bappy.links.modifyPlans(link.id, { add: ["…another plan id…"] }); // top-up
await omax.bappy.sms.send({ link_id: link.id, message: "Welcome! Your data is active." });

for await (const l of await omax.bappy.links.list({ status: "active", metadata: { customer_id: "c-1042" } })) {
  console.log(l.id, l.iccid);
}
```

Bappy responses are typed with the fields we document; other fields are present as `unknown`.

## Phone Numbers

```ts
const available = await omax.phoneNumbers.searchAvailable({ country_iso: "GB", number_type: "local" });
const purchase = await omax.phoneNumbers.purchase({ /* see the API reference */ });

for await (const n of await omax.phoneNumbers.list({ status: "active" })) console.log(n.e164);

await omax.phoneNumbers.sms.send({ from: "+442071234567", to: "+447911123456", body: "Hello" });
for await (const s of await omax.phoneNumbers.sms.list({ direction: "inbound" })) console.log(s.body);
```

## Webhooks

Pass the **raw** request body, the headers and your endpoint's signing secret. You get the event, typed by its `type`:

```ts
import express from "express";
import { Omax, OmaxWebhookVerificationError } from "@omaxtelecom/sdk";

const omax = new Omax();
const app = express();

app.post("/hooks/omax", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = omax.webhooks.verify(req.body, req.headers, process.env.OMAX_WEBHOOK_SECRET!);
  } catch (error) {
    if (error instanceof OmaxWebhookVerificationError) return res.sendStatus(401);
    throw error;
  }
  res.sendStatus(200); // answer first, then process

  switch (event.type) {
    case "sms.message.delivered":
      console.log("delivered", event.sms.id, event.sms.delivered_at);
      break;
    case "bappy.usage.threshold_reached":
      console.log(event.usage.iccid, event.usage.used_percent);
      break;
  }
});
```

- De-duplicate on the `svix-id` header: an event can arrive more than once.
- While you rotate the secret, pass both: `verify(body, headers, [newSecret, oldSecret])`.
- `omax.webhooks.sign(payload, secret)` signs a payload like we do, to test your handler.

Every event and its fields: [Webhooks guide](https://developer.omaxtelecom.com/webhooks).

## Errors

```ts
import { OmaxApiError } from "@omaxtelecom/sdk";

try {
  await omax.sms.messages.send({ from: "ACME", to: "+38765123456", text: "Hi" });
} catch (error) {
  if (error instanceof OmaxApiError) {
    console.log(error.status, error.code, error.requestId, error.fields);
    if (error.code === "THROTTLED_OR_INSUFFICIENT_FUNDS") { /* top up */ }
  }
  throw error;
}
```

| Error | When |
|-------|------|
| `OmaxApiError` | The API answered with an error. Branch on `code`, quote `requestId` to support |
| `OmaxAuthenticationError` | The client ID or secret was rejected |
| `OmaxConnectionError` / `OmaxTimeoutError` | No response |
| `OmaxWebhookVerificationError` | A webhook failed verification |

## Retries and idempotency

| Situation | What the SDK does |
|-----------|-------------------|
| `429 Too Many Requests` | Waits for `Retry-After` and retries |
| `401` | Gets a new token and retries once |
| `5xx` or lost connection on a read (`GET`) | Retries with backoff |
| Lost connection on a write with an `Idempotency-Key` (SMS send, OTP send, number purchase…) | Retries with the same key, so it happens once |
| `5xx` or lost connection on any other write | Does not retry: the result is unknown, so check before you try again |

Retries default to 2; change them with `maxRetries`. Use your own idempotency key (for example your order ID) with `{ idempotencyKey: "order-42" }` as the last argument.

## Options

```ts
new Omax({
  clientId, clientSecret,   // or accessToken: "…"
  timeoutMs: 30_000,        // per attempt
  maxRetries: 2,
  fetch,                    // your own fetch, e.g. with a proxy
});

// Per call, as the last argument:
await omax.sms.wallet({ timeoutMs: 5_000, maxRetries: 0, signal: controller.signal });
```

## Support

- API reference: https://developer.omaxtelecom.com
- Support: support@omaxtelecom.com — include the `requestId` of the error.

## License

MIT
