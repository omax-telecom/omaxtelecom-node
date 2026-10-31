// Not run: `npm run typecheck` checks that the README examples match the SDK's types.
import { Omax, OmaxApiError } from "../src/index.js";

export async function readmeExamples(omax: Omax): Promise<void> {
  const message = await omax.sms.messages.send({ from: "ACME", to: "+38765123456", text: "Your order has shipped." });
  console.log(message.id, message.status);
  await omax.sms.messages.sendBulk({ from: "ACME", text: "Sale today", to: ["+38765123456", "+38766123456"] });
  await omax.sms.messages.get(message.id);
  for await (const m of await omax.sms.messages.list({ status: "delivered" })) console.log(m.id, m.to);
  await omax.sms.wallet();
  await omax.sms.senderIds.request({ name: "ACME", use_case: "Order notifications" });
  const { verification_id } = await omax.otp.send({ from: "ACME", to: "+38765123456" });
  await omax.otp.verify({ verification_id, code: "123456" });

  const link = await omax.bappy.links.create({ plan_id: "p", name: "Trip to Italy", metadata: { customer_id: "c-1042" } });
  await omax.bappy.links.modifyPlans(link.id, { add: ["p2"] });
  await omax.bappy.sms.send({ link_id: link.id, message: "Welcome! Your data is active." });
  for await (const l of await omax.bappy.links.list({ status: "active", metadata: { customer_id: "c-1042" } })) console.log(l.id, l.iccid);

  await omax.phoneNumbers.searchAvailable({ country_iso: "GB", number_type: "local" });
  for await (const n of await omax.phoneNumbers.list({ status: "active" })) console.log(n.e164);
  await omax.phoneNumbers.sms.send({ from: "+442071234567", to: "+447911123456", body: "Hello" });
  for await (const s of await omax.phoneNumbers.sms.list({ direction: "inbound" })) console.log(s.body);

  try {
    await omax.sms.messages.send({ from: "ACME", to: "+38765123456", text: "Hi" }, { idempotencyKey: "order-42" });
  } catch (error) {
    if (error instanceof OmaxApiError) console.log(error.status, error.code, error.requestId, error.fields);
  }
  await omax.sms.wallet({ timeoutMs: 5_000, maxRetries: 0, signal: new AbortController().signal });

  const event = omax.webhooks.verify("{}", {}, "whsec_x");
  switch (event.type) {
    case "sms.message.delivered":
      console.log(event.sms.id, event.sms.delivered_at);
      break;
    case "bappy.usage.threshold_reached":
      console.log(event.usage.iccid, event.usage.used_percent);
      break;
  }
}
