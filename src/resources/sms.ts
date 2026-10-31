import type { HttpClient, RequestOptions } from "../core/http.js";
import { fetchPage, metaPages, type Page } from "../core/pagination.js";
import type { BodyOf, DataOf, ItemOf, QueryOf } from "../core/types.js";
import type { operations } from "../generated/sms.js";

type Ops = operations;

export type SmsMessage = DataOf<Ops["getMessage"]>;
export type SmsMessageListItem = ItemOf<Ops["listMessages"]>;
export type SmsSendMessageParams = BodyOf<Ops["sendMessage"]>;
export type SmsSendBulkParams = BodyOf<Ops["sendBulk"]>;
export type SmsListMessagesParams = QueryOf<Ops["listMessages"]>;
export type SmsBatch = DataOf<Ops["getBatch"]>;
export type SmsListBatchesParams = QueryOf<Ops["listBatches"]>;
export type SmsSenderId = ItemOf<Ops["listSenderIds"]>;
export type SmsRequestSenderIdParams = BodyOf<Ops["requestSenderId"]>;
export type OtpSendParams = BodyOf<Ops["sendOtp"]>;
export type OtpSent = DataOf<Ops["sendOtp"]>;
export type OtpVerifyParams = BodyOf<Ops["verifyOtp"]>;
export type OtpResult = DataOf<Ops["verifyOtp"]>;

export const SMS_BASE_URL = "https://api.omaxtelecom.com/sms";

class Messages {
  constructor(private readonly http: HttpClient, private readonly baseUrl: string) {}

  /**
   * Send one SMS. An `Idempotency-Key` is sent for you (pass `idempotencyKey`
   * to use your own), so a retried call never sends the message twice.
   */
  async send(params: SmsSendMessageParams, options?: RequestOptions): Promise<DataOf<Ops["sendMessage"]>> {
    const res = await this.http.request<DataOf<Ops["sendMessage"]>>({
      method: "POST", baseUrl: this.baseUrl, path: "/messages", body: params, idempotency: "required", options,
    });
    return res.data;
  }

  /** Send one text to up to 10,000 numbers. Returns the batch; sending happens in the background. */
  async sendBulk(params: SmsSendBulkParams, options?: RequestOptions): Promise<DataOf<Ops["sendBulk"]>> {
    const res = await this.http.request<DataOf<Ops["sendBulk"]>>({
      method: "POST", baseUrl: this.baseUrl, path: "/messages/bulk", body: params, idempotency: "required", options,
    });
    return res.data;
  }

  /** One message with its delivery status. */
  async get(id: string, options?: RequestOptions): Promise<SmsMessage> {
    const res = await this.http.request<SmsMessage>({
      method: "GET", baseUrl: this.baseUrl, path: `/messages/${encodeURIComponent(id)}`, options,
    });
    return res.data;
  }

  /** Your messages, newest first. Use `for await` to go through every page. */
  list(params: SmsListMessagesParams = {}, options?: RequestOptions): Promise<Page<SmsMessageListItem>> {
    return fetchPage<SmsMessageListItem>(this.http, { method: "GET", baseUrl: this.baseUrl, path: "/messages", query: params, options }, metaPages);
  }
}

class Batches {
  constructor(private readonly http: HttpClient, private readonly baseUrl: string) {}

  /** Your bulk requests, newest first. */
  list(params: SmsListBatchesParams = {}, options?: RequestOptions): Promise<Page<ItemOf<Ops["listBatches"]>>> {
    return fetchPage<ItemOf<Ops["listBatches"]>>(this.http, { method: "GET", baseUrl: this.baseUrl, path: "/batches", query: params, options }, metaPages);
  }

  /** Per-status counts of one bulk request. */
  async get(id: string, options?: RequestOptions): Promise<SmsBatch> {
    const res = await this.http.request<SmsBatch>({
      method: "GET", baseUrl: this.baseUrl, path: `/batches/${encodeURIComponent(id)}`, options,
    });
    return res.data;
  }
}

class SenderIds {
  constructor(private readonly http: HttpClient, private readonly baseUrl: string) {}

  /** Your sender IDs and their review status. */
  async list(options?: RequestOptions): Promise<DataOf<Ops["listSenderIds"]>> {
    const res = await this.http.request<DataOf<Ops["listSenderIds"]>>({
      method: "GET", baseUrl: this.baseUrl, path: "/sender-ids", options,
    });
    return res.data;
  }

  /** Request a new sender ID. It is reviewed before you can send with it. */
  async request(params: SmsRequestSenderIdParams, options?: RequestOptions): Promise<DataOf<Ops["requestSenderId"]>> {
    const res = await this.http.request<DataOf<Ops["requestSenderId"]>>({
      method: "POST", baseUrl: this.baseUrl, path: "/sender-ids", body: params, options,
    });
    return res.data;
  }
}

/** SMS API: https://developer.omaxtelecom.com/sms-api */
export class Sms {
  readonly messages: Messages;
  readonly batches: Batches;
  readonly senderIds: SenderIds;

  constructor(private readonly http: HttpClient, private readonly baseUrl: string = SMS_BASE_URL) {
    this.messages = new Messages(http, baseUrl);
    this.batches = new Batches(http, baseUrl);
    this.senderIds = new SenderIds(http, baseUrl);
  }

  /** Check your token and organization. */
  async me(options?: RequestOptions): Promise<DataOf<Ops["getMe"]>> {
    return (await this.http.request<DataOf<Ops["getMe"]>>({ method: "GET", baseUrl: this.baseUrl, path: "/me", options })).data;
  }

  /** SMS balance and account mode (live or test). */
  async wallet(options?: RequestOptions): Promise<DataOf<Ops["getWallet"]>> {
    return (await this.http.request<DataOf<Ops["getWallet"]>>({ method: "GET", baseUrl: this.baseUrl, path: "/wallet", options })).data;
  }

  /** Your price per segment by destination prefix. */
  async pricing(options?: RequestOptions): Promise<DataOf<Ops["getPricing"]>> {
    return (await this.http.request<DataOf<Ops["getPricing"]>>({ method: "GET", baseUrl: this.baseUrl, path: "/pricing", options })).data;
  }

  /** Totals and per-day traffic for the last 1 to 90 days. */
  async stats(params: QueryOf<Ops["getStats"]> = {}, options?: RequestOptions): Promise<DataOf<Ops["getStats"]>> {
    return (
      await this.http.request<DataOf<Ops["getStats"]>>({ method: "GET", baseUrl: this.baseUrl, path: "/stats", query: params, options })
    ).data;
  }

  /** Service availability (no token needed). */
  async health(options?: RequestOptions): Promise<DataOf<Ops["getHealth"]>> {
    return (
      await this.http.request<DataOf<Ops["getHealth"]>>({ method: "GET", baseUrl: this.baseUrl, path: "/health", public: true, options })
    ).data;
  }
}

/** OTP API: https://developer.omaxtelecom.com/otp-api */
export class Otp {
  constructor(private readonly http: HttpClient, private readonly baseUrl: string = SMS_BASE_URL) {}

  /** Send a one-time code by SMS. Keep the returned `verification_id` with the user's session. */
  async send(params: OtpSendParams, options?: RequestOptions): Promise<OtpSent> {
    const res = await this.http.request<OtpSent>({
      method: "POST", baseUrl: this.baseUrl, path: "/otp/send", body: params, idempotency: "required", options,
    });
    return res.data;
  }

  /** Check the code the user typed. */
  async verify(params: OtpVerifyParams, options?: RequestOptions): Promise<OtpResult> {
    const res = await this.http.request<OtpResult>({
      method: "POST", baseUrl: this.baseUrl, path: "/otp/verify", body: params, options,
    });
    return res.data;
  }
}
