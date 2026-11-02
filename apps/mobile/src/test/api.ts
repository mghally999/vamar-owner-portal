/**
 * Global fetch stub. Routes are keyed `METHOD /path` (no query string); a route is a reply, a
 * function of the request, or an Error to simulate a dead connection. Unknown routes answer 404.
 */
export interface Reply {
  status?: number;
  statusText?: string;
  /** Omitted: the body is not JSON. */
  body?: unknown;
}

export interface SentRequest {
  method: string;
  path: string;
  url: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
}

type Route = Reply | Error | ((req: SentRequest) => Reply | Error | Promise<Reply | Error>);

const routes = new Map<string, Route>();

function toResponse(reply: Reply) {
  const status = reply.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: reply.statusText ?? '',
    json: () =>
      'body' in reply
        ? Promise.resolve(JSON.parse(JSON.stringify(reply.body)) as unknown)
        : Promise.reject(new SyntaxError('Unexpected end of JSON input')),
  };
}

function parse(input: string, init: RequestInit = {}): SentRequest {
  const url = new URL(input);
  const raw = init.body;
  return {
    method: (init.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    url: input,
    query: url.searchParams,
    headers: new Headers(init.headers),
    body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined,
  };
}

export const fetchMock = jest.fn(async (input: string, init?: RequestInit) => {
  const req = parse(input, init);
  const route = routes.get(`${req.method} ${req.path}`);
  const reply =
    route === undefined
      ? { status: 404, body: { error: { code: 'not_found', message: 'Not found' } } }
      : typeof route === 'function'
        ? await route(req)
        : route;
  if (reply instanceof Error) throw reply;
  return toResponse(reply);
});

/** Adds or replaces routes. */
export function mockApi(map: Record<string, Route>): void {
  for (const [key, route] of Object.entries(map)) routes.set(key, route);
}

/** Every request sent to `METHOD /path`, oldest first. */
export function sent(key: string): SentRequest[] {
  return fetchMock.mock.calls
    .map(([input, init]) => parse(input, init))
    .filter((r) => `${r.method} ${r.path}` === key);
}

export function resetApi(): void {
  routes.clear();
  fetchMock.mockClear();
}

export const offline = () => new TypeError('Network request failed');
