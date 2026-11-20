import type { FetchFn } from '../src/check';

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  created_at: string;
  state: 'open' | 'closed';
  labels: string[];
  comments: { created_at: string; body: string }[];
}

/** In-memory GitHub REST API: just the issue, comment and label routes the monitor calls. */
export class FakeGitHub {
  issues: FakeIssue[] = [];
  labels = new Set<string>();
  calls: string[] = [];
  /** Status every request answers with instead of the normal answer (for example 401). */
  failWith: number | null = null;
  private next = 1;

  constructor(private readonly now: () => number) {}

  addIssue(title: string, body: string, createdAt: string): FakeIssue {
    const issue: FakeIssue = {
      number: this.next++,
      title,
      body,
      created_at: createdAt,
      state: 'open',
      labels: ['outage'],
      comments: [],
    };
    this.issues.push(issue);
    return issue;
  }

  open(): FakeIssue[] {
    return this.issues.filter((i) => i.state === 'open');
  }

  handle(method: string, url: URL, body: unknown): Response {
    this.calls.push(`${method} ${url.pathname}`);
    if (this.failWith !== null)
      return Response.json({ message: 'Bad credentials' }, { status: this.failWith });
    const path = url.pathname.replace(/^\/repos\/owner\/repo/, '');
    const nowIso = new Date(this.now()).toISOString();
    const issueMatch = /^\/issues\/(\d+)(\/comments)?$/.exec(path);
    const issue = issueMatch
      ? this.issues.find((i) => i.number === Number(issueMatch[1]))
      : undefined;
    const input = body as Record<string, unknown>;

    if (method === 'GET' && path === '/issues') {
      const label = url.searchParams.get('labels') ?? '';
      return Response.json(this.open().filter((i) => i.labels.includes(label)));
    }
    if (method === 'GET' && issue && issueMatch?.[2]) {
      const since = Date.parse(url.searchParams.get('since') ?? '1970-01-01T00:00:00Z');
      return Response.json(issue.comments.filter((c) => Date.parse(c.created_at) >= since));
    }
    if (method === 'POST' && path === '/labels') {
      const name = String(input['name']);
      if (this.labels.has(name))
        return Response.json({ message: 'already_exists' }, { status: 422 });
      this.labels.add(name);
      return Response.json({ name }, { status: 201 });
    }
    if (method === 'POST' && path === '/issues') {
      const created = this.addIssue(String(input['title']), String(input['body']), nowIso);
      created.labels = input['labels'] as string[];
      return Response.json({ number: created.number }, { status: 201 });
    }
    if (method === 'POST' && issue && issueMatch?.[2]) {
      issue.comments.push({ created_at: nowIso, body: String(input['body']) });
      return Response.json({}, { status: 201 });
    }
    if (method === 'PATCH' && issue) {
      issue.state = input['state'] === 'closed' ? 'closed' : 'open';
      return Response.json({ number: issue.number });
    }
    return Response.json({ message: 'Not Found' }, { status: 404 });
  }
}

export type TargetAnswer = { status: number; body: string } | 'no answer';

/**
 * fetch() for the tests: api.github.com goes to the fake GitHub, any other URL answers from
 * `answers` (keyed by the full URL; a missing key answers 200 ok; a list answers in turn and
 * then keeps answering with its last entry).
 */
export function fakeFetch(gh: FakeGitHub, answers: Map<string, TargetAnswer | TargetAnswer[]>) {
  const targetCalls: string[] = [];
  const fetchFn: FetchFn = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === 'api.github.com') {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      return Promise.resolve(gh.handle(init?.method ?? 'GET', url, body));
    }
    targetCalls.push(input);
    const entry = answers.get(input) ?? { status: 200, body: '{"ok":true,"db":true}' };
    const answer = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;
    if (answer === undefined) throw new Error(`no answer listed for ${input}`);
    if (answer === 'no answer') throw new DOMException('timed out', 'TimeoutError');
    return Promise.resolve(new Response(answer.body, { status: answer.status }));
  };
  return { fetchFn, targetCalls };
}

/** KVNamespace with only get(key, 'json') and put(), which is all the monitor uses. */
export class FakeKV {
  data = new Map<string, string>();
  writes = 0;

  get(key: string, _type: 'json'): Promise<unknown> {
    const value = this.data.get(key);
    return Promise.resolve(value === undefined ? null : (JSON.parse(value) as unknown));
  }

  put(key: string, value: string): Promise<void> {
    this.writes++;
    this.data.set(key, value);
    return Promise.resolve();
  }

  asKV(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}
