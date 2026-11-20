import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueTitle } from '../src/alerts';
import { handleRequest } from '../src/index';
import { health, runOnce, STATUS_KEY, type Env, type Status } from '../src/run';
import { FakeGitHub, FakeKV, fakeFetch, type TargetAnswer } from './fakes';

const PROD = 'https://prod.example.dev';
const STG = 'https://stg.example.dev';
const TARGETS = [
  { name: 'production', base: PROD, readyEveryMinutes: 30 },
  { name: 'staging', base: STG, readyEveryMinutes: 120 },
];
const at = (iso: string) => Date.parse(iso);
const DOWN = { status: 503, body: '{"ok":false,"db":false}' };

function harness(env: Partial<Env> = {}) {
  let clock = at('2026-11-20T10:00:00Z');
  const gh = new FakeGitHub(() => clock);
  const answers = new Map<string, TargetAnswer | TargetAnswer[]>();
  const { fetchFn, targetCalls } = fakeFetch(gh, answers);
  const kv = new FakeKV();
  const fullEnv: Env = {
    STATE: kv.asKV(),
    TARGETS,
    GITHUB_REPO: 'owner/repo',
    GITHUB_TOKEN: 'token',
    UPTIME_MENTION: '',
    ...env,
  };
  /** One cron run at `iso` (the scheduled time; the run itself takes a few seconds). */
  const run = (iso: string) => {
    clock = at(iso) + 3_000;
    return runOnce(fullEnv, at(iso), {
      fetch: fetchFn,
      sleep: () => Promise.resolve(),
      now: () => clock,
      check: { timeoutMs: 1_000, retryDelayMs: 0, tries: 2 },
    });
  };
  return { gh, answers, targetCalls, kv, env: fullEnv, run, now: () => clock };
}

describe('runOnce', () => {
  beforeEach(() => {
    // runOnce logs each down target with console.warn; the assertions cover what it saw.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('all up outside a /readyz slot: /healthz only, no GitHub writes, status stored', async () => {
    const h = harness();
    const status = await h.run('2026-11-20T10:05:00Z');
    expect(h.targetCalls).toEqual([`${PROD}/healthz`, `${STG}/healthz`]);
    expect(h.gh.calls).toEqual(['GET /repos/owner/repo/issues']);
    expect(status).toMatchObject({
      alerts: 'github-token',
      github: { ok: true, error: null },
      targets: {
        production: { up: true, path: '/healthz', code: '200', issue: null, action: 'none' },
        staging: { up: true, path: '/healthz', code: '200', issue: null, action: 'none' },
      },
    });
    expect(JSON.parse(h.kv.data.get(STATUS_KEY) ?? 'null')).toEqual(status);
    expect(h.kv.writes).toBe(1);
  });

  it('calls /readyz on each target slot: production every 30 min, staging every 2 h', async () => {
    const h = harness();
    await h.run('2026-11-20T10:00:00Z');
    await h.run('2026-11-20T10:30:00Z');
    expect(h.targetCalls).toEqual([
      `${PROD}/readyz`,
      `${STG}/readyz`,
      `${PROD}/readyz`,
      `${STG}/healthz`,
    ]);
  });

  it('down, still down, changed, recovered: one issue, quiet repeats, then closed', async () => {
    const h = harness({ UPTIME_MENTION: '@owner' });
    h.answers.set(`${PROD}/readyz`, DOWN);

    // 10:00 /readyz fails twice: the issue opens (the "down" e-mail).
    let status = await h.run('2026-11-20T10:00:00Z');
    expect(h.gh.open()).toHaveLength(1);
    const issue = h.gh.open()[0];
    expect(issue?.title).toBe(issueTitle('production'));
    expect(issue?.labels).toEqual(['outage']);
    expect(issue?.body).toContain('- Status: 503');
    expect(issue?.body).toContain('<!-- uptime-status:503 -->');
    expect(issue?.body).toMatch(/cc @owner$/);
    expect([...h.gh.labels]).toEqual(['outage']);
    expect(status.targets['production']).toMatchObject({ up: false, action: 'open', issue: 1 });
    expect(status.targets['staging']).toMatchObject({ up: true, action: 'none' });

    // 10:05 is not a /readyz slot, but the open issue makes it check /readyz anyway; same status
    // noted 5 minutes ago: no comment.
    h.targetCalls.length = 0;
    status = await h.run('2026-11-20T10:05:00Z');
    expect(h.targetCalls).toContain(`${PROD}/readyz`);
    expect(status.targets['production']).toMatchObject({ up: false, action: 'none', issue: 1 });
    expect(issue?.comments).toHaveLength(0);

    // 11:00, same 503 for an hour: one reminder comment.
    status = await h.run('2026-11-20T11:00:00Z');
    expect(status.targets['production']?.action).toBe('comment');
    expect(issue?.comments).toHaveLength(1);
    expect(issue?.comments[0]?.body).toMatch(/^Still down\. /);

    // 11:05 the status changes to no answer: a comment right away.
    h.answers.set(`${PROD}/readyz`, 'no answer');
    status = await h.run('2026-11-20T11:05:00Z');
    expect(status.targets['production']).toMatchObject({ code: '000', action: 'comment' });
    expect(issue?.comments[1]?.body).toContain('<!-- uptime-status:000 -->');
    await h.run('2026-11-20T11:10:00Z');
    expect(issue?.comments).toHaveLength(2);

    // 11:15 it answers again: recovery comment and the issue closes (the "recovered" e-mail).
    h.answers.delete(`${PROD}/readyz`);
    status = await h.run('2026-11-20T11:15:00Z');
    expect(status.targets['production']).toMatchObject({ up: true, action: 'close', issue: null });
    expect(issue?.state).toBe('closed');
    expect(issue?.comments[2]?.body).toMatch(/^Recovered: \*\*production\*\*/);

    // 11:20 back to /healthz and silence.
    h.targetCalls.length = 0;
    status = await h.run('2026-11-20T11:20:00Z');
    expect(h.targetCalls).toEqual([`${PROD}/healthz`, `${STG}/healthz`]);
    expect(status.targets['production']?.action).toBe('none');
    expect(h.gh.issues).toHaveLength(1);
  });

  it('a /healthz failure opens the same issue', async () => {
    const h = harness();
    h.answers.set(`${STG}/healthz`, { status: 500, body: 'Worker threw exception' });
    const status = await h.run('2026-11-20T10:05:00Z');
    expect(status.targets['staging']).toMatchObject({
      up: false,
      path: '/healthz',
      action: 'open',
    });
    expect(h.gh.open()[0]?.title).toBe(issueTitle('staging'));
    expect(h.gh.open()[0]?.body).toContain(`GET ${STG}/healthz`);
  });

  it('a retry that answers is not an outage', async () => {
    const h = harness();
    h.answers.set(`${PROD}/healthz`, [
      { status: 502, body: '' },
      { status: 200, body: '{"ok":true}' },
    ]);
    const status = await h.run('2026-11-20T10:05:00Z');
    expect(status.targets['production']).toMatchObject({ up: true, attempts: 2, action: 'none' });
    expect(h.gh.issues).toHaveLength(0);
  });

  it('continues an issue the workflow opened and does not repeat its recent note', async () => {
    const h = harness();
    h.gh.addIssue(
      issueTitle('production'),
      'opened by the workflow <!-- uptime-status:503 -->',
      '2026-11-20T10:02:00Z',
    );
    h.answers.set(`${PROD}/readyz`, DOWN);
    const status = await h.run('2026-11-20T10:05:00Z');
    expect(status.targets['production']).toMatchObject({ up: false, action: 'none', issue: 1 });
    expect(h.gh.issues).toHaveLength(1);
  });

  it('without credentials it still checks and records, but cannot alert', async () => {
    const h = harness({ GITHUB_TOKEN: '' });
    h.answers.set(`${PROD}/readyz`, DOWN);
    const status = await h.run('2026-11-20T10:00:00Z');
    expect(h.gh.calls).toEqual([]);
    expect(status).toMatchObject({
      alerts: 'off',
      github: { ok: false },
      targets: { production: { up: false, action: 'none' } },
    });
    expect(health(status, h.now())).toEqual({
      ok: false,
      reason: 'alerts off: no GitHub credentials',
    });
  });

  it('a refused GitHub token is reported; the next run still uses /readyz for a down target', async () => {
    const h = harness();
    h.gh.failWith = 401;
    h.answers.set(`${PROD}/readyz`, DOWN);
    const status = await h.run('2026-11-20T10:00:00Z');
    expect(status.github.ok).toBe(false);
    expect(status.github.error).toMatch(/401/);
    expect(status.targets['production']).toMatchObject({ up: false, action: 'none' });
    expect(health(status, h.now()).reason).toMatch(
      /^GitHub: GET \/repos\/owner\/repo\/issues: 401/,
    );

    h.targetCalls.length = 0;
    await h.run('2026-11-20T10:05:00Z');
    expect(h.targetCalls).toContain(`${PROD}/readyz`);
  });

  it('uses the GitHub App when its id and key are set', async () => {
    const h = harness({ GITHUB_TOKEN: '', GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'bad' });
    const status = await h.run('2026-11-20T10:05:00Z');
    expect(status.alerts).toBe('github-app');
    expect(status.github.error).toMatch(/not a PEM private key/);
  });
});

describe('health and the HTTP endpoints', () => {
  const fresh: Status = {
    at: '2026-11-20T10:00:03.000Z',
    scheduledTime: '2026-11-20T10:00:00.000Z',
    alerts: 'github-app',
    github: { ok: true, error: null },
    targets: {},
  };

  it('is healthy for 20 minutes after a good run', () => {
    expect(health(fresh, at('2026-11-20T10:20:00Z'))).toEqual({ ok: true, reason: null });
    expect(health(fresh, at('2026-11-20T10:25:00Z'))).toEqual({
      ok: false,
      reason: 'last run 25 min ago',
    });
    expect(health(null, 0)).toEqual({ ok: false, reason: 'no run recorded yet' });
  });

  it('GET /readyz answers like the portal: 200 ok true, or 503 with the reason', async () => {
    const kv = new FakeKV();
    const env = { STATE: kv.asKV() } as Env;
    const get = (path: string, now: number, method = 'GET') =>
      handleRequest(new Request(`https://vamar-uptime.example.dev${path}`, { method }), env, now);

    let res = await get('/readyz', at('2026-11-20T10:00:00Z'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: 'no run recorded yet', lastRun: null });
    expect((await get('/status', 0)).status).toBe(404);

    await kv.put(STATUS_KEY, JSON.stringify(fresh));
    res = await get('/readyz', at('2026-11-20T10:05:00Z'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true,"lastRun":"2026-11-20T10:00:03.000Z"}');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await (await get('/status', 0)).json()).toEqual(fresh);
    expect((await get('/', 0)).status).toBe(200);
    expect((await get('/other', 0)).status).toBe(404);
    expect((await get('/readyz', 0, 'POST')).status).toBe(405);
  });
});
