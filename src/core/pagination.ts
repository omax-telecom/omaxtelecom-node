import type { HttpClient, HttpRequest, Query } from "./http.js";

export type PageInfo = {
  /** Current page number (page-based lists). */
  page: number | null;
  perPage: number | null;
  total: number | null;
  lastPage: number | null;
  /** Cursor of the next page (cursor-based lists). */
  nextCursor: string | null;
};

/**
 * One page of a list. Iterate it with `for await` to go through every item of
 * every page; the next pages are fetched as you go.
 */
export class Page<T> implements AsyncIterable<T> {
  constructor(
    /** Items on this page. */
    readonly items: T[],
    readonly info: PageInfo,
    private readonly fetchNext: (() => Promise<Page<T>>) | null,
  ) {}

  hasNextPage(): boolean {
    return this.fetchNext !== null;
  }

  /** The next page, or `null` on the last one. */
  async nextPage(): Promise<Page<T> | null> {
    return this.fetchNext ? this.fetchNext() : null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page: Page<T> | null = this;
    while (page) {
      yield* page.items;
      page = await page.nextPage();
    }
  }
}

type Extracted = { items: unknown[]; info: PageInfo; nextQuery: Query | null };

export type Extractor = (data: unknown, meta: Record<string, unknown> | null, query: Query) => Extracted;

/** Fetch one page and keep the request to fetch the following ones. */
export async function fetchPage<T>(http: HttpClient, req: HttpRequest, extract: Extractor): Promise<Page<T>> {
  const query = req.query ?? {};
  const response = await http.request<unknown>(req);
  const { items, info, nextQuery } = extract(response.data, response.meta, query);
  const next = nextQuery && items.length > 0 ? () => fetchPage<T>(http, { ...req, query: nextQuery }, extract) : null;
  return new Page(items as T[], info, next);
}

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const emptyInfo: PageInfo = { page: null, perPage: null, total: null, lastPage: null, nextCursor: null };

/** `data: T[]` with `meta: { page, per_page, total, last_page }` (SMS API). */
export function metaPages(data: unknown, meta: Record<string, unknown> | null, query: Query): Extracted {
  const page = num(meta?.page) ?? 1;
  const lastPage = num(meta?.last_page);
  return {
    items: (data as unknown[]) ?? [],
    info: { ...emptyInfo, page, perPage: num(meta?.per_page), total: num(meta?.total), lastPage },
    nextQuery: lastPage !== null && page < lastPage ? { ...query, page: page + 1 } : null,
  };
}

/** `data: { items, page, per_page, total }` (Phone Numbers API). */
export function itemPages(data: unknown, _meta: unknown, query: Query): Extracted {
  const d = (data ?? {}) as Record<string, unknown>;
  const page = num(d.page) ?? 1;
  const perPage = num(d.per_page);
  const total = num(d.total);
  const lastPage = total !== null && perPage ? Math.max(1, Math.ceil(total / perPage)) : null;
  return {
    items: (d.items as unknown[]) ?? [],
    info: { ...emptyInfo, page, perPage, total, lastPage },
    nextQuery: lastPage !== null && page < lastPage ? { ...query, page: page + 1 } : null,
  };
}

/** `data: { items, next_cursor }` (Phone Numbers SMS messages). */
export function cursorPages(data: unknown, _meta: unknown, query: Query): Extracted {
  const d = (data ?? {}) as Record<string, unknown>;
  const nextCursor = typeof d.next_cursor === "string" && d.next_cursor !== "" ? d.next_cursor : null;
  return {
    items: (d.items as unknown[]) ?? [],
    info: { ...emptyInfo, nextCursor },
    nextQuery: nextCursor ? { ...query, cursor: nextCursor } : null,
  };
}

/** `data: { data: T[], meta: { current_page, last_page, per_page, total } }` (Bappy API). */
export function nestedPages(data: unknown, _meta: unknown, query: Query): Extracted {
  const d = (data ?? {}) as Record<string, unknown>;
  const m = (d.meta ?? {}) as Record<string, unknown>;
  const page = num(m.current_page) ?? 1;
  const lastPage = num(m.last_page);
  return {
    items: (d.data as unknown[]) ?? [],
    info: { ...emptyInfo, page, perPage: num(m.per_page), total: num(m.total), lastPage },
    nextQuery: lastPage !== null && page < lastPage ? { ...query, page: page + 1 } : null,
  };
}
