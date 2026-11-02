/**
 * A fake staff API for component tests: global fetch is stubbed with a small route table and every
 * request is recorded, so a test can check both what the page shows and what it sent.
 */
import { vi } from 'vitest';

export interface ApiCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Headers;
}

/** A non-2xx answer; plain values are sent as 200 JSON. */
export interface Reply {
  readonly reply: true;
  status: number;
  body: unknown;
}

export function reply(status: number, body: unknown = {}): Reply {
  return { reply: true, status, body };
}

export function apiError(status: number, code: string, message = code, details?: unknown): Reply {
  return reply(status, { error: { code, message, details } });
}

export type Handler = ((call: ApiCall) => unknown) | object | null;
export type Routes = Record<string, Handler>;

function isReply(v: unknown): v is Reply {
  return typeof v === 'object' && v !== null && 'reply' in v;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Route keys look like "GET /api/staff/owners/:id"; a ":name" segment matches any one segment. */
function match(routes: Routes, method: string, path: string): Handler | undefined {
  if (`${method} ${path}` in routes) return routes[`${method} ${path}`];
  const parts = path.split('/');
  for (const [key, handler] of Object.entries(routes)) {
    const [m, p] = key.split(' ');
    if (m !== method || !p) continue;
    const pattern = p.split('/');
    if (pattern.length !== parts.length) continue;
    if (pattern.every((seg, i) => (seg.startsWith(':') ? parts[i] !== '' : seg === parts[i])))
      return handler;
  }
  return undefined;
}

export function mockApi(routes: Routes) {
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = init?.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const call: ApiCall = {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    const handler = match(routes, method, url.pathname);
    if (handler === undefined)
      return json(404, { error: { code: 'not_found', message: `${method} ${url.pathname}` } });
    const out =
      typeof handler === 'function' ? await (handler as (c: ApiCall) => unknown)(call) : handler;
    if (out instanceof Response) return out;
    if (isReply(out)) return json(out.status, out.body);
    return json(200, out ?? {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    fetch: fetchMock,
    /** Calls to one route, e.g. api.to('POST', '/api/staff/owners'). */
    to(method: string, path: string): ApiCall[] {
      return calls.filter((c) => c.method === method && c.path === path);
    },
    /** The most recent call to a route; throws when there was none. */
    last(method: string, path: string): ApiCall {
      const hit = calls.filter((c) => c.method === method && c.path === path).at(-1);
      if (!hit)
        throw new Error(
          `no ${method} ${path} call; saw ${calls.map((c) => `${c.method} ${c.path}`).join(', ')}`,
        );
      return hit;
    },
  };
}

export type MockApi = ReturnType<typeof mockApi>;
