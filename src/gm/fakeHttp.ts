/** Test helper: a fetch that records requests and answers with a canned JSON reply. */
export interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, any>;
}

export function fakeFetch(reply: { status?: number; body: unknown }, captured: Captured[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

export const failingFetch: typeof fetch = (async () => {
  throw new TypeError('Failed to fetch');
}) as typeof fetch;
