import { describe, expect, it } from "vitest";
import { fakeApi, ok } from "./helpers.js";

describe("SMS API", () => {
  it("sends to the right URL and pages through every message", async () => {
    const api = fakeApi([
      ok([{ id: "1" }, { id: "2" }], { page: 1, per_page: 2, total: 3, last_page: 2 }),
      ok([{ id: "3" }], { page: 2, per_page: 2, total: 3, last_page: 2 }),
    ]);
    const omax = api.client();
    const first = await omax.sms.messages.list({ status: "delivered", per_page: 2 });
    expect(first.info).toMatchObject({ page: 1, total: 3, lastPage: 2 });

    const ids: string[] = [];
    for await (const m of first) ids.push(m.id);

    expect(ids).toEqual(["1", "2", "3"]);
    expect(api.calls[0]!.url.toString()).toBe("https://api.omaxtelecom.com/sms/messages?status=delivered&per_page=2");
    expect(api.calls[1]!.url.searchParams.get("page")).toBe("2");
  });

  it("OTP send carries an Idempotency-Key, verify does not", async () => {
    const api = fakeApi([ok({ verification_id: "v1" }), ok({ verified: true })]);
    const omax = api.client();
    await omax.otp.send({ to: "38761123456" } as never);
    await omax.otp.verify({ verification_id: "v1", code: "123456" } as never);

    expect(api.calls[0]!.url.pathname).toBe("/sms/otp/send");
    expect(api.calls[0]!.headers.has("Idempotency-Key")).toBe(true);
    expect(api.calls[1]!.headers.has("Idempotency-Key")).toBe(false);
    expect(JSON.parse(String(api.calls[1]!.body))).toEqual({ verification_id: "v1", code: "123456" });
  });
});

describe("Phone Numbers API", () => {
  it("pages with items/total and buys with an Idempotency-Key", async () => {
    const api = fakeApi([
      ok({ items: [{ id: "n1" }, { id: "n2" }], page: 1, per_page: 2, total: 3 }),
      ok({ items: [{ id: "n3" }], page: 2, per_page: 2, total: 3 }),
      ok({ order_id: "o1" }),
    ]);
    const omax = api.client();
    const ids: string[] = [];
    for await (const n of await omax.phoneNumbers.list({ per_page: 2 })) ids.push(n.id);
    await omax.phoneNumbers.purchase({ country_iso: "GB" } as never);

    expect(ids).toEqual(["n1", "n2", "n3"]);
    expect(api.calls[0]!.url.toString()).toBe("https://api.omaxtelecom.com/numbers/?per_page=2");
    expect(api.calls[2]!.method).toBe("POST");
    expect(api.calls[2]!.headers.has("Idempotency-Key")).toBe(true);
  });

  it("follows next_cursor for SMS messages", async () => {
    const api = fakeApi([ok({ items: [{ id: "s1" }], next_cursor: "c2" }), ok({ items: [{ id: "s2" }], next_cursor: null })]);
    const ids: string[] = [];
    for await (const s of await api.client().phoneNumbers.sms.list({ direction: "inbound" })) ids.push(s.id!);

    expect(ids).toEqual(["s1", "s2"]);
    expect(api.calls[1]!.url.searchParams.get("cursor")).toBe("c2");
    expect(api.calls[1]!.url.searchParams.get("direction")).toBe("inbound");
  });

  it("uploads a KYC document as multipart form data", async () => {
    const api = fakeApi([ok({ id: "d1" })]);
    await api.client().phoneNumbers.kyc.uploadDocument({ file: new Blob(["%PDF"]), filename: "id.pdf", type: "passport" });

    const body = api.calls[0]!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("type")).toBe("passport");
    expect(api.calls[0]!.headers.has("Content-Type")).toBe(false);
  });
});

describe("Bappy API", () => {
  it("pages through Links (data.data + data.meta) and filters by metadata", async () => {
    const api = fakeApi([
      ok({ data: [{ id: "l1" }], meta: { current_page: 1, last_page: 2, per_page: 1, total: 2 } }),
      ok({ data: [{ id: "l2" }], meta: { current_page: 2, last_page: 2, per_page: 1, total: 2 } }),
    ]);
    const ids: string[] = [];
    for await (const link of await api.client().bappy.links.list({ metadata: { customer: "c-1" }, per_page: 1 })) ids.push(link.id);

    expect(ids).toEqual(["l1", "l2"]);
    expect(api.calls[0]!.url.toString()).toBe(
      "https://api.omaxtelecom.com/bappy/v1/links?metadata%5Bcustomer%5D=c-1&per_page=1",
    );
  });

  it("creates a Link and tops it up", async () => {
    const api = fakeApi([ok({ id: "l1", iccid: "89" }), ok({ ok: true })]);
    const omax = api.client();
    const link = await omax.bappy.links.create({ plan_id: "p1", name: "Trip" });
    await omax.bappy.links.modifyPlans(link.id, { add: ["p2"] });

    expect(api.calls[0]!.url.pathname).toBe("/bappy/v1/links");
    expect(api.calls[1]!.method).toBe("PUT");
    expect(api.calls[1]!.url.pathname).toBe("/bappy/v1/links/l1/plans");
    expect(JSON.parse(String(api.calls[1]!.body))).toEqual({ add: ["p2"] });
  });
});
