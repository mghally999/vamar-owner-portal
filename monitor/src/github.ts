import { LABEL } from './alerts';
import { USER_AGENT, type FetchFn } from './check';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/** Returns the bearer token for the next API call. */
export type TokenSource = () => Promise<string>;

export interface IssueSummary {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
}

async function call<T>(
  fetchFn: FetchFn,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': USER_AGENT,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetchFn(API + path, {
    method,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GitHubError(
      res.status,
      `${method} ${path.split('?')[0] ?? path}: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return (text === '' ? null : JSON.parse(text)) as T;
}

/** The few REST calls the monitor needs, on one repository ("owner/name"). */
export class GitHub {
  constructor(
    private readonly repo: string,
    private readonly token: TokenSource,
    private readonly fetchFn: FetchFn,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return call<T>(this.fetchFn, await this.token(), method, `/repos/${this.repo}${path}`, body);
  }

  async openOutageIssues(): Promise<IssueSummary[]> {
    const list = await this.call<(IssueSummary & { pull_request?: unknown })[]>(
      'GET',
      `/issues?labels=${LABEL}&state=open&per_page=100`,
    );
    return list.filter((i) => i.pull_request === undefined);
  }

  /** Issue body plus the comments written since `sinceMs`, oldest first. */
  async entriesSince(
    issue: IssueSummary,
    sinceMs: number,
  ): Promise<{ createdAt: string; body: string | null }[]> {
    const comments = await this.call<{ created_at: string; body: string | null }[]>(
      'GET',
      `/issues/${issue.number}/comments?per_page=100&since=${new Date(sinceMs).toISOString()}`,
    );
    return [
      { createdAt: issue.created_at, body: issue.body },
      ...comments.map((c) => ({ createdAt: c.created_at, body: c.body })),
    ];
  }

  /** Creates the `outage` label once; "already exists" (422) is fine. */
  async ensureLabel(): Promise<void> {
    try {
      await this.call('POST', '/labels', {
        name: LABEL,
        color: 'B60205',
        description: 'Production or staging does not answer /readyz',
      });
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 422)) throw e;
    }
  }

  async createIssue(title: string, body: string): Promise<number> {
    const issue = await this.call<{ number: number }>('POST', '/issues', {
      title,
      body,
      labels: [LABEL],
    });
    return issue.number;
  }

  async comment(issue: number, body: string): Promise<void> {
    await this.call('POST', `/issues/${issue}/comments`, { body });
  }

  async close(issue: number, comment: string): Promise<void> {
    await this.comment(issue, comment);
    await this.call('PATCH', `/issues/${issue}`, { state: 'closed', state_reason: 'completed' });
  }
}

export function staticToken(token: string): TokenSource {
  return () => Promise.resolve(token);
}

/**
 * GitHub App authentication: a short JWT signed with the App's private key finds the App's
 * installation on the repository and exchanges it for an installation token (valid one hour,
 * limited here to issues). Issues are then written by "<app name>[bot]", so the repository owner
 * gets the usual e-mail; GitHub sends none for issues a person's own token opens.
 */
export function appToken(
  appId: string,
  privateKeyPem: string,
  repo: string,
  fetchFn: FetchFn,
  now: () => number,
): TokenSource {
  return async () => {
    const jwt = await appJwt(appId, privateKeyPem, Math.floor(now() / 1000));
    const installation = await call<{ id: number }>(
      fetchFn,
      jwt,
      'GET',
      `/repos/${repo}/installation`,
    );
    const access = await call<{ token: string }>(
      fetchFn,
      jwt,
      'POST',
      `/app/installations/${installation.id}/access_tokens`,
      { permissions: { issues: 'write' } },
    );
    return access.token;
  };
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const utf8 = (text: string) => new TextEncoder().encode(text);

/** RS256 JWT for the GitHub App: issued a minute in the past (clock drift), valid 9 minutes. */
export async function appJwt(
  appId: string,
  privateKeyPem: string,
  nowSec: number,
): Promise<string> {
  const header = base64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const iss = /^\d+$/.test(appId) ? Number(appId) : appId;
  const payload = base64url(utf8(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss })));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    utf8(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let rest = n; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/**
 * DER bytes of the private key in PKCS#8, which WebCrypto imports. GitHub hands out PKCS#1
 * ("BEGIN RSA PRIVATE KEY"); that is wrapped here, so the downloaded .pem can be stored as is.
 * Literal "\n" sequences (a key pasted on one line) are accepted too.
 */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const text = pem.replace(/\\n/g, '\n');
  const match =
    /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (?:RSA )?PRIVATE KEY-----/.exec(text);
  const b64 = match?.[2];
  if (!match || b64 === undefined) {
    throw new Error('GITHUB_APP_PRIVATE_KEY is not a PEM private key');
  }
  const der = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  if (match[1] === undefined) return der;
  // PrivateKeyInfo { version 0, AlgorithmIdentifier rsaEncryption NULL, OCTET STRING pkcs1 }
  const rsaEncryption = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const inner = [0x02, 0x01, 0x00, ...rsaEncryption, 0x04, ...derLength(der.length), ...der];
  return new Uint8Array([0x30, ...derLength(inner.length), ...inner]);
}
