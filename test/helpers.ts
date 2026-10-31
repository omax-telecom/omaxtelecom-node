import { Omax, type OmaxOptions } from "../src/index.js";

export type Call = { url: URL; method: string; headers: Headers; body: string | FormData | null };
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

/**
 * A fake fetch. Token requests are answered automatically; every other call
 * takes the next reply from the queue.
 */
export function fakeApi(replies: Reply[], tokenReplies: Reply[] = []) {
  const calls: Call[] = [];
  const tokenCalls: Call[] = [];
  const queue = [...replies];
  const tokenQueue = [...tokenReplies];

  const fetch: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: (init?.body as string | FormData | undefined) ?? null,
    };
    const isToken = url.pathname === "/auth/token";
    (isToken ? tokenCalls : calls).push(call);

    const reply = isToken
      ? (tokenQueue.shift() ?? { body: { access_token: `token-${tokenCalls.length}`, token_type: "Bearer", expires_in: 300 } })
      : queue.shift();
    if (reply === undefined) throw new Error(`Unexpected request ${call.method} ${url}`);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json", ...reply.headers },
    });
  }) as typeof fetch;

  const client = (options: OmaxOptions = {}) =>
    new Omax({ clientId: "id", clientSecret: "secret", fetch, maxRetries: 2, ...options });

  return { fetch, calls, tokenCalls, client, pending: () => queue.length };
}

export const ok = (data: unknown, meta?: unknown) => ({ body: { success: true, data, ...(meta ? { meta } : {}) } });
export const fail = (status: number, code: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) => ({
  status,
  body: { success: false, error: { code, message: `${code} message`, ...extra } },
  headers,
});
