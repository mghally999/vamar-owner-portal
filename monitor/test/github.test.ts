import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../src/check';
import { appJwt, appToken, GitHub, GitHubError, pemToPkcs8, staticToken } from '../src/github';
import { FakeGitHub, fakeFetch } from './fakes';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = createPublicKey(privateKey);

function decodePart(part: string | undefined): Record<string, unknown> {
  return JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

function verifies(jwt: string): boolean {
  const [header, payload, signature] = jwt.split('.');
  return createVerify('RSA-SHA256')
    .update(`${header}.${payload}`)
    .verify(publicKey, Buffer.from(signature ?? '', 'base64url'));
}

describe('pemToPkcs8', () => {
  it('turns the PKCS#1 key GitHub hands out into the same PKCS#8 bytes Node writes', () => {
    const expected = privateKey.export({ type: 'pkcs8', format: 'der' });
    expect(Buffer.from(pemToPkcs8(pkcs1)).equals(expected)).toBe(true);
    expect(Buffer.from(pemToPkcs8(pkcs8)).equals(expected)).toBe(true);
  });

  it('accepts a key pasted on one line with literal \\n', () => {
    const oneLine = pkcs1.trim().split('\n').join('\\n');
    expect(Buffer.from(pemToPkcs8(oneLine)).equals(Buffer.from(pemToPkcs8(pkcs1)))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(() => pemToPkcs8('ghp_notakey')).toThrow(/not a PEM private key/);
  });
});

describe('appJwt', () => {
  it('signs an RS256 JWT the App public key verifies, issued a minute back', async () => {
    const jwt = await appJwt('123456', pkcs1, 1_000_000);
    expect(verifies(jwt)).toBe(true);
    const [header, payload] = jwt.split('.');
    expect(decodePart(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodePart(payload)).toEqual({ iat: 999_940, exp: 1_000_540, iss: 123456 });
  });

  it('keeps a client id as text', async () => {
    const jwt = await appJwt('Iv23liAbc', pkcs8, 1_000_000);
    expect(decodePart(jwt.split('.')[1])['iss']).toBe('Iv23liAbc');
  });
});

describe('appToken', () => {
  it('finds the installation with the JWT and returns an issues-only installation token', async () => {
    const seen: { url: string; auth: string; body: unknown }[] = [];
    const fetchFn: FetchFn = (input, init) => {
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      seen.push({
        url: input,
        auth,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      const answer = input.endsWith('/installation')
        ? { id: 42 }
        : { token: 'ghs_installation', expires_at: '2026-11-20T21:00:00Z' };
      return Promise.resolve(
        Response.json(answer, { status: input.endsWith('/installation') ? 200 : 201 }),
      );
    };
    const token = await appToken('1', pkcs1, 'owner/repo', fetchFn, () => 1_000_000_000)();
    expect(token).toBe('ghs_installation');
    expect(seen.map((s) => s.url)).toEqual([
      'https://api.github.com/repos/owner/repo/installation',
      'https://api.github.com/app/installations/42/access_tokens',
    ]);
    expect(seen.every((s) => verifies(s.auth.replace('Bearer ', '')))).toBe(true);
    expect(seen[1]?.body).toEqual({ permissions: { issues: 'write' } });
  });
});

describe('GitHub client', () => {
  const setup = () => {
    const fake = new FakeGitHub(() => Date.parse('2026-11-20T19:00:00Z'));
    const { fetchFn } = fakeFetch(fake, new Map());
    return { fake, gh: new GitHub('owner/repo', staticToken('t'), fetchFn) };
  };

  it('creates the label once and treats "already exists" as done', async () => {
    const { fake, gh } = setup();
    await gh.ensureLabel();
    await gh.ensureLabel();
    expect([...fake.labels]).toEqual(['outage']);
  });

  it('lists only open outage issues, not pull requests', async () => {
    const fetchFn: FetchFn = () =>
      Promise.resolve(
        Response.json([
          { number: 1, title: 'a', body: null, created_at: 'x' },
          { number: 2, title: 'b', body: null, created_at: 'x', pull_request: {} },
        ]),
      );
    const issues = await new GitHub('owner/repo', staticToken('t'), fetchFn).openOutageIssues();
    expect(issues.map((i) => i.number)).toEqual([1]);
  });

  it('raises GitHubError with the status on a refused call', async () => {
    const { fake, gh } = setup();
    fake.failWith = 401;
    await expect(gh.openOutageIssues()).rejects.toMatchObject({
      name: 'GitHubError',
      status: 401,
      message: expect.stringMatching(/^GET \/repos\/owner\/repo\/issues: 401 /) as unknown,
    });
    await expect(gh.ensureLabel()).rejects.toBeInstanceOf(GitHubError);
  });
});
