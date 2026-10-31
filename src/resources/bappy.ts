import type { HttpClient, HttpRequest, RequestOptions } from "../core/http.js";
import { fetchPage, nestedPages, type Page } from "../core/pagination.js";

/*
 * The Bappy API reference does not publish response schemas yet, so these
 * types list the fields we know and allow more. Request parameters follow the
 * API's validation rules.
 */

export const BAPPY_BASE_URL = "https://api.omaxtelecom.com/bappy/v1";

export type BappyLinkStatus = "active" | "suspended" | "inactive" | "deactivated";

/** A Link: one eSIM or physical SIM and everything attached to it. */
export type BappyLink = {
  id: string;
  name: string | null;
  /** Your own key/value data (up to 20 keys, string values). */
  metadata: Record<string, string> | null;
  iccid: string | null;
  sim_type?: string | null;
  status: BappyLinkStatus | string;
  /** When suspended: `manual` or `inactivity`. */
  status_reason?: string | null;
  suspended_at?: string | null;
  activations_count?: number;
  msisdn?: string | null;
  created_at?: string;
  [field: string]: unknown;
};

/** Any Bappy object; fields depend on the endpoint (see the API reference). */
export type BappyObject = Record<string, unknown>;

export type BappyListParams = { page?: number; per_page?: number };

export type BappyListLinksParams = BappyListParams & {
  status?: Exclude<BappyLinkStatus, "deactivated">;
  /** Search by ICCID, name or ID. */
  search?: string;
  sim_type?: string;
  /** Only Links whose metadata has these exact values. */
  metadata?: Record<string, string>;
};

export type BappyCreateLinkParams = {
  /** The plan to activate on the new Link. */
  plan_id: string;
  name?: string | null;
  metadata?: Record<string, string> | null;
};

export type BappyUpdateLinkParams = {
  name?: string | null;
  status?: "active" | "suspended" | "inactive" | null;
  metadata?: Record<string, string> | null;
};

export type BappyModifyPlansParams = {
  /** Plan IDs to add (top-up). */
  add?: string[];
  /** Activation IDs to remove. */
  remove?: string[];
};

export type BappyListPlansParams = BappyListParams & {
  /** `EU`, `AF`, `AS`, `LA`, `NA` or `OC`. */
  region?: string;
  coverage_type?: string;
  sponsor_profile?: string;
};

export type BappySendSmsParams = {
  link_id: string;
  /** Up to 80 characters. */
  message: string;
};

const id = (value: string): string => encodeURIComponent(value);

class Resource {
  constructor(protected readonly http: HttpClient, protected readonly baseUrl: string) {}

  protected async call<T>(req: Omit<HttpRequest, "baseUrl">): Promise<T> {
    return (await this.http.request<T>({ ...req, baseUrl: this.baseUrl })).data;
  }

  protected page<T>(path: string, query: HttpRequest["query"], options?: RequestOptions): Promise<Page<T>> {
    return fetchPage<T>(this.http, { method: "GET", baseUrl: this.baseUrl, path, query, options }, nestedPages);
  }
}

class Links extends Resource {
  /** Your Links. Use `for await` to go through every page. */
  list(params: BappyListLinksParams = {}, options?: RequestOptions): Promise<Page<BappyLink>> {
    return this.page("/links", params, options);
  }

  /**
   * Create a Link with a plan. The plan price is taken from your wallet and
   * refunded automatically if provisioning fails. Not retried automatically
   * after a lost connection, so a Link is never created twice: check
   * `links.list()` before trying again.
   */
  create(params: BappyCreateLinkParams, options?: RequestOptions): Promise<BappyLink> {
    return this.call({ method: "POST", path: "/links", body: params, options });
  }

  /** One Link by UUID or ICCID, with its activations and usage. */
  get(identifier: string, options?: RequestOptions): Promise<BappyLink> {
    return this.call({ method: "GET", path: `/links/${id(identifier)}`, options });
  }

  /** Rename, suspend or reactivate a Link, or change its metadata. */
  update(identifier: string, params: BappyUpdateLinkParams, options?: RequestOptions): Promise<BappyLink> {
    return this.call({ method: "PUT", path: `/links/${id(identifier)}`, body: params, options });
  }

  /** Add plans to a Link (top-up) or remove activations. */
  modifyPlans(identifier: string, params: BappyModifyPlansParams, options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "PUT", path: `/links/${id(identifier)}/plans`, body: params, options });
  }

  /** Plans that can be added to this Link. */
  topupPlans(identifier: string, params: BappyListParams = {}, options?: RequestOptions): Promise<Page<BappyObject>> {
    return this.page(`/links/${id(identifier)}/topup-plans`, params, options);
  }

  /** Activations, top-ups, SMS and monthly fees of one Link. */
  history(identifier: string, params: BappyListParams = {}, options?: RequestOptions): Promise<Page<BappyObject>> {
    return this.page(`/links/${id(identifier)}/history`, params, options);
  }

  /** Where the card is connected. `live: true` asks the network instead of the last known state. */
  networkStatus(identifier: string, params: { live?: boolean } = {}, options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: `/links/${id(identifier)}/network-status`, query: params, options });
  }
}

class Plans extends Resource {
  /** Available plans with price, data, validity and coverage. */
  list(params: BappyListPlansParams = {}, options?: RequestOptions): Promise<Page<BappyObject>> {
    return this.page("/plans", params, options);
  }

  get(planId: string, options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: `/plans/${id(planId)}`, options });
  }

  /** Every country of a plan with its operators and network types. */
  coverage(planId: string, options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: `/plans/${id(planId)}/coverage`, options });
  }

  /** Regions for filtering plans. */
  regions(options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: "/plans/regions", options });
  }
}

class Sms extends Resource {
  /** SMS sent to your Links. */
  list(params: BappyListParams & { link_id?: string } = {}, options?: RequestOptions): Promise<Page<BappyObject>> {
    return this.page("/sms", params, options);
  }

  /** Send an SMS (up to 80 characters) to a Link. */
  send(params: BappySendSmsParams, options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "POST", path: "/sms", body: params, options });
  }
}

class Transactions extends Resource {
  /** Wallet transactions, optionally for one Link. */
  list(params: BappyListParams & { link_id?: string } = {}, options?: RequestOptions): Promise<Page<BappyObject>> {
    return this.page("/transactions", params, options);
  }

  /** Totals for a date range. */
  stats(params: { from?: string; to?: string } = {}, options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: "/transactions/stats", query: params, options });
  }

  /** Spending and usage for the last `period_days`. */
  analytics(params: { period_days?: number } = {}, options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: "/transactions/analytics", query: params, options });
  }
}

class Organization extends Resource {
  /** Name, status and your prices (`price_per_sms`, `price_per_link`). */
  get(options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: "/organization", options });
  }

  /** Wallet balance and currency. */
  balance(options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: "/organization/balance", options });
  }
}

class Info extends Resource {
  /** eSIM installation instructions. */
  instructions(options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: "/info/instructions", options });
  }

  /** Mobile operators by country name. */
  operators(params: { search?: string } = {}, options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: "/info/operators", query: params, options });
  }
}

/** Bappy API: https://developer.omaxtelecom.com/bundle-sim */
export class Bappy extends Resource {
  readonly links: Links;
  readonly plans: Plans;
  readonly sms: Sms;
  readonly transactions: Transactions;
  readonly organization: Organization;
  readonly info: Info;

  constructor(http: HttpClient, baseUrl: string = BAPPY_BASE_URL) {
    super(http, baseUrl);
    this.links = new Links(http, baseUrl);
    this.plans = new Plans(http, baseUrl);
    this.sms = new Sms(http, baseUrl);
    this.transactions = new Transactions(http, baseUrl);
    this.organization = new Organization(http, baseUrl);
    this.info = new Info(http, baseUrl);
  }

  /** Service availability (no token needed). */
  health(options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: "/health", public: true, options });
  }

  /** Detailed status of the API (no token needed). */
  status(options?: RequestOptions): Promise<BappyObject> {
    return this.call({ method: "GET", path: "/status", public: true, options });
  }
}
