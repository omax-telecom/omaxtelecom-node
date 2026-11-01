// Not run: `npm run typecheck` checks the SDK examples shown on developer.omaxtelecom.com.
import { Omax } from "../src/index.js";

export async function docsExamples(): Promise<void> {
  // Getting started
  const omax = new Omax({ clientId: process.env.OMAX_CLIENT_ID, clientSecret: process.env.OMAX_CLIENT_SECRET });
  const me = await omax.sms.me();
  console.log(me);

  // SMS API
  const message = await omax.sms.messages.send({ from: "ACME", to: "+38765123456", text: "Your order has shipped.", reference: "order-1042" });
  const current = await omax.sms.messages.get(message.id);
  console.log(current.status);
  for await (const m of await omax.sms.messages.list({ status: "delivered", reference: "order-1042" })) console.log(m.id, m.to);

  // OTP API
  const { verification_id } = await omax.otp.send({ from: "ACME", to: "+38765123456" });
  const result = await omax.otp.verify({ verification_id, code: "123456" });
  console.log(result);

  // Bappy API
  const plans = await omax.bappy.plans.list({ region: "EU" });
  const balance = await omax.bappy.organization.balance();
  const link = await omax.bappy.links.create({ plan_id: String(plans.items[0]?.id), name: "Trip to Italy" });
  const details = await omax.bappy.links.get(link.id);
  console.log(balance, details);
  for await (const l of await omax.bappy.links.list({ status: "active" })) console.log(l.id, l.iccid, l.status);

  // Phone Numbers API
  const { numbers } = await omax.phoneNumbers.searchAvailable({ country_iso: "GB", number_type: "local" });
  const number_ids = [numbers[0]!.id];
  const { quote } = await omax.phoneNumbers.preview({ number_ids, billing_period: "monthly" });
  const purchase = await omax.phoneNumbers.purchase({
    number_ids,
    billing_period: "monthly",
    quote_token: quote.quote_token,
    expected_total_cost_minor: quote.upfront_total.amount_minor,
  });
  console.log(purchase.order);
}

// Webhooks
export function webhookHandler(omax: Omax, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): void {
  const event = omax.webhooks.verify(rawBody, headers, process.env.OMAX_WEBHOOK_SECRET!);
  if (event.type === "phone_numbers.sms.received") {
    console.log(event.sms.from, event.sms.body);
  }
}
