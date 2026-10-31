import type { HttpClient, HttpRequest, RequestOptions } from "../core/http.js";
import { cursorPages, fetchPage, itemPages, type Page } from "../core/pagination.js";
import type { BodyOf, DataOf, ItemOf, QueryOf } from "../core/types.js";
import type { components, operations } from "../generated/phone-numbers.js";

type Ops = operations;
type Schemas = components["schemas"];

export type PhoneNumber = Schemas["PhoneNumber"];
export type PhoneNumberOrder = Schemas["Order"];
export type PhoneNumberEndpoint = Schemas["Endpoint"];
export type PhoneNumberSms = Schemas["SmsMessage"];
export type PhoneNumberSmsDetail = Schemas["SmsMessageDetail"];
export type PortRequest = Schemas["PortRequest"];

export const PHONE_NUMBERS_BASE_URL = "https://api.omaxtelecom.com/numbers";

const id = (value: string): string => encodeURIComponent(value);

/** Shared request helper: returns the `data` of the envelope. */
class Resource {
  constructor(protected readonly http: HttpClient, protected readonly baseUrl: string) {}

  protected async call<T>(req: Omit<HttpRequest, "baseUrl">): Promise<T> {
    return (await this.http.request<T>({ ...req, baseUrl: this.baseUrl })).data;
  }
}

class Orders extends Resource {
  /** Your single and bulk orders. */
  list(params: QueryOf<Ops["listOrders"]> = {}, options?: RequestOptions): Promise<Page<PhoneNumberOrder>> {
    return fetchPage<PhoneNumberOrder>(this.http, { method: "GET", baseUrl: this.baseUrl, path: "/orders", query: params, options }, itemPages);
  }

  get(orderId: string, options?: RequestOptions): Promise<DataOf<Ops["getOrder"]>> {
    return this.call({ method: "GET", path: `/orders/${id(orderId)}`, options });
  }
}

class BulkOrders extends Resource {
  /** Price and availability of a bulk order, without buying. */
  preview(params: BodyOf<Ops["previewBulkOrder"]>, options?: RequestOptions): Promise<DataOf<Ops["previewBulkOrder"]>> {
    return this.call({ method: "POST", path: "/bulk-orders/preview", body: params, options });
  }

  /** Place a bulk order. An `Idempotency-Key` is sent for you. */
  place(params: BodyOf<Ops["placeBulkOrder"]>, options?: RequestOptions): Promise<DataOf<Ops["placeBulkOrder"]>> {
    return this.call({ method: "POST", path: "/bulk-orders", body: params, idempotency: "required", options });
  }
}

class Endpoints extends Resource {
  list(params: QueryOf<Ops["listEndpoints"]> = {}, options?: RequestOptions): Promise<Page<ItemOf<Ops["listEndpoints"]>>> {
    return fetchPage<ItemOf<Ops["listEndpoints"]>>(this.http, { method: "GET", baseUrl: this.baseUrl, path: "/endpoints", query: params, options }, itemPages);
  }

  /** Create a voice (SIP) or SMS (`mailto:`) endpoint. */
  create(params: BodyOf<Ops["createEndpoint"]>, options?: RequestOptions): Promise<DataOf<Ops["createEndpoint"]>> {
    return this.call({ method: "POST", path: "/endpoints", body: params, idempotency: "optional", options });
  }

  get(endpointId: string, options?: RequestOptions): Promise<DataOf<Ops["getEndpoint"]>> {
    return this.call({ method: "GET", path: `/endpoints/${id(endpointId)}`, options });
  }

  update(endpointId: string, params: BodyOf<Ops["updateEndpoint"]>, options?: RequestOptions): Promise<DataOf<Ops["updateEndpoint"]>> {
    return this.call({ method: "PATCH", path: `/endpoints/${id(endpointId)}`, body: params, options });
  }

  /** Delete an endpoint. It must not be assigned to a number. */
  delete(endpointId: string, options?: RequestOptions): Promise<DataOf<Ops["deleteEndpoint"]>> {
    return this.call({ method: "DELETE", path: `/endpoints/${id(endpointId)}`, options });
  }
}

class Sms extends Resource {
  /** Send an SMS from one of your numbers. An `Idempotency-Key` is sent for you. */
  send(params: BodyOf<Ops["sendSms"]>, options?: RequestOptions): Promise<DataOf<Ops["sendSms"]>> {
    return this.call({ method: "POST", path: "/sms/messages", body: params, idempotency: "required", options });
  }

  /** Inbound or outbound messages (`direction` is required), newest first, with cursor paging. */
  list(params: QueryOf<Ops["listSmsMessages"]>, options?: RequestOptions): Promise<Page<ItemOf<Ops["listSmsMessages"]>>> {
    return fetchPage<ItemOf<Ops["listSmsMessages"]>>(this.http, { method: "GET", baseUrl: this.baseUrl, path: "/sms/messages", query: params, options }, cursorPages);
  }

  get(messageId: string, options?: RequestOptions): Promise<DataOf<Ops["getSmsMessage"]>> {
    return this.call({ method: "GET", path: `/sms/messages/${id(messageId)}`, options });
  }

  /** Forward an inbound message to its SMS endpoint again. */
  retry(messageId: string, options?: RequestOptions): Promise<DataOf<Ops["retryInboundSms"]>> {
    return this.call({ method: "POST", path: `/sms/messages/${id(messageId)}/retry`, options });
  }

  /** Your SMS prices. */
  pricing(options?: RequestOptions): Promise<DataOf<Ops["getSmsPricing"]>> {
    return this.call({ method: "GET", path: "/sms/pricing", options });
  }
}

class Kyc extends Resource {
  /** Fields and document types needed for a country and number type. */
  requirements(params: QueryOf<Ops["getKycRequirements"]>, options?: RequestOptions): Promise<DataOf<Ops["getKycRequirements"]>> {
    return this.call({ method: "GET", path: "/kyc/requirements", query: params, options });
  }

  /** Upload one KYC document (PDF, JPG or PNG up to 10 MB). */
  uploadDocument(
    params: { file: Blob; filename?: string; type: string },
    options?: RequestOptions,
  ): Promise<DataOf<Ops["uploadKycDocument"]>> {
    const form = new FormData();
    // `File` is not a global on Node 18, so read the name without instanceof.
    const name = (params.file as Blob & { name?: unknown }).name;
    form.append("file", params.file, params.filename ?? (typeof name === "string" && name !== "" ? name : "document"));
    form.append("type", params.type);
    return this.call({ method: "POST", path: "/kyc/documents", form, idempotency: "optional", options });
  }

  /** KYC of your organization. */
  getOrganization(options?: RequestOptions): Promise<DataOf<Ops["getOrganizationKyc"]>> {
    return this.call({ method: "GET", path: "/kyc/organization", options });
  }

  submitOrganization(params: BodyOf<Ops["submitOrganizationKyc"]>, options?: RequestOptions): Promise<DataOf<Ops["submitOrganizationKyc"]>> {
    return this.call({ method: "POST", path: "/kyc/organization", body: params, idempotency: "optional", options });
  }

  /** KYC of one number. */
  get(phoneNumberId: string, options?: RequestOptions): Promise<DataOf<Ops["getPhoneNumberKyc"]>> {
    return this.call({ method: "GET", path: `/${id(phoneNumberId)}/kyc`, options });
  }

  submit(phoneNumberId: string, params: BodyOf<Ops["submitPhoneNumberKyc"]>, options?: RequestOptions): Promise<DataOf<Ops["submitPhoneNumberKyc"]>> {
    return this.call({ method: "POST", path: `/${id(phoneNumberId)}/kyc`, body: params, idempotency: "optional", options });
  }
}

class Porting extends Resource {
  /** Price of porting a number in. */
  portInQuote(options?: RequestOptions): Promise<DataOf<Ops["getPortInQuote"]>> {
    return this.call({ method: "GET", path: "/port-ins/quote", options });
  }

  /** Port a number in. An `Idempotency-Key` is sent for you. */
  portIn(params: BodyOf<Ops["createPortIn"]>, options?: RequestOptions): Promise<DataOf<Ops["createPortIn"]>> {
    return this.call({ method: "POST", path: "/port-ins", body: params, idempotency: "required", options });
  }

  /** Request a porting code to move one of your numbers out. */
  portOut(phoneNumberId: string, params: BodyOf<Ops["createPortOut"]> = {}, options?: RequestOptions): Promise<DataOf<Ops["createPortOut"]>> {
    return this.call({ method: "POST", path: `/${id(phoneNumberId)}/port-out`, body: params, options });
  }

  list(params: QueryOf<Ops["listPortRequests"]> = {}, options?: RequestOptions): Promise<Page<PortRequest>> {
    return fetchPage<PortRequest>(this.http, { method: "GET", baseUrl: this.baseUrl, path: "/port-requests", query: params, options }, itemPages);
  }

  get(portRequestId: string, options?: RequestOptions): Promise<DataOf<Ops["getPortRequest"]>> {
    return this.call({ method: "GET", path: `/port-requests/${id(portRequestId)}`, options });
  }

  cancel(portRequestId: string, options?: RequestOptions): Promise<DataOf<Ops["requestPortCancellation"]>> {
    return this.call({ method: "POST", path: `/port-requests/${id(portRequestId)}/cancellation`, options });
  }
}

/** Phone Numbers API: https://developer.omaxtelecom.com/phone-numbers-api */
export class PhoneNumbers extends Resource {
  readonly orders: Orders;
  readonly bulkOrders: BulkOrders;
  readonly endpoints: Endpoints;
  readonly sms: Sms;
  readonly kyc: Kyc;
  readonly porting: Porting;

  constructor(http: HttpClient, baseUrl: string = PHONE_NUMBERS_BASE_URL) {
    super(http, baseUrl);
    this.orders = new Orders(http, baseUrl);
    this.bulkOrders = new BulkOrders(http, baseUrl);
    this.endpoints = new Endpoints(http, baseUrl);
    this.sms = new Sms(http, baseUrl);
    this.kyc = new Kyc(http, baseUrl);
    this.porting = new Porting(http, baseUrl);
  }

  /** Numbers you can buy. */
  searchAvailable(params: QueryOf<Ops["searchAvailableNumbers"]>, options?: RequestOptions): Promise<DataOf<Ops["searchAvailableNumbers"]>> {
    return this.call({ method: "GET", path: "/available", query: params, options });
  }

  /** Price of a purchase, without buying. */
  preview(params: BodyOf<Ops["previewPurchase"]>, options?: RequestOptions): Promise<DataOf<Ops["previewPurchase"]>> {
    return this.call({ method: "POST", path: "/preview", body: params, options });
  }

  /** Buy numbers. An `Idempotency-Key` is sent for you, so a retry never buys twice. */
  purchase(params: BodyOf<Ops["purchasePhoneNumbers"]>, options?: RequestOptions): Promise<DataOf<Ops["purchasePhoneNumbers"]>> {
    return this.call({ method: "POST", path: "/", body: params, idempotency: "required", options });
  }

  /** Your numbers. Use `for await` to go through every page. */
  list(params: QueryOf<Ops["listPhoneNumbers"]> = {}, options?: RequestOptions): Promise<Page<ItemOf<Ops["listPhoneNumbers"]>>> {
    return fetchPage<ItemOf<Ops["listPhoneNumbers"]>>(this.http, { method: "GET", baseUrl: this.baseUrl, path: "/", query: params, options }, itemPages);
  }

  get(phoneNumberId: string, options?: RequestOptions): Promise<DataOf<Ops["getPhoneNumber"]>> {
    return this.call({ method: "GET", path: `/${id(phoneNumberId)}`, options });
  }

  /** Assign voice and SMS endpoints. Fields you leave out stay unchanged; `null` removes an assignment. */
  updateRouting(phoneNumberId: string, params: BodyOf<Ops["updatePhoneNumberRouting"]>, options?: RequestOptions): Promise<DataOf<Ops["updatePhoneNumberRouting"]>> {
    return this.call({ method: "PATCH", path: `/${id(phoneNumberId)}`, body: params, options });
  }

  /** Release a number. */
  release(phoneNumberId: string, options?: RequestOptions): Promise<DataOf<Ops["releasePhoneNumber"]>> {
    return this.call({ method: "DELETE", path: `/${id(phoneNumberId)}`, options });
  }

  /** Countries and number types you can buy. */
  coverage(options?: RequestOptions): Promise<DataOf<Ops["getCoverage"]>> {
    return this.call({ method: "GET", path: "/coverage", options });
  }

  /** Service availability (no token needed). */
  health(options?: RequestOptions): Promise<DataOf<Ops["getPhoneNumbersHealth"]>> {
    return this.call({ method: "GET", path: "/health", public: true, options });
  }
}
