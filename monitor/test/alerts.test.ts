import { describe, expect, it } from 'vitest';
import {
  decide,
  downReport,
  issueTitle,
  lastMark,
  openBody,
  recoveredComment,
  stamp,
  stillDownComment,
} from '../src/alerts';
import type { CheckResult } from '../src/check';

const now = Date.parse('2026-11-20T19:42:10Z');
const minutes = (n: number) => n * 60_000;

describe('decide (the alert state machine)', () => {
  it('up without an issue: nothing', () => {
    expect(decide(true, '200', null, now)).toEqual({ kind: 'none' });
  });

  it('down without an issue: open one (the "down" alert)', () => {
    expect(decide(false, '503', null, now)).toEqual({ kind: 'open' });
  });

  it('up with an open issue: close it (the "recovered" alert)', () => {
    const issue = { number: 7, last: { code: '503', at: now - minutes(5) } };
    expect(decide(true, '200', issue, now)).toEqual({ kind: 'close', issue: 7 });
  });

  it('still down with the same status noted recently: stay quiet', () => {
    const issue = { number: 7, last: { code: '503', at: now - minutes(54) } };
    expect(decide(false, '503', issue, now)).toEqual({ kind: 'none' });
  });

  it('still down: comment when the status changes, or after 55 minutes', () => {
    const recent = { number: 7, last: { code: '503', at: now - minutes(5) } };
    expect(decide(false, '000', recent, now)).toEqual({ kind: 'comment', issue: 7 });
    const old = { number: 7, last: { code: '503', at: now - minutes(55) } };
    expect(decide(false, '503', old, now)).toEqual({ kind: 'comment', issue: 7 });
    expect(decide(false, '503', { number: 7, last: null }, now)).toEqual({
      kind: 'comment',
      issue: 7,
    });
  });
});

describe('lastMark', () => {
  it('takes the newest uptime-status marker from the body and comments', () => {
    expect(
      lastMark([
        { createdAt: '2026-11-20T18:00:00Z', body: 'x <!-- uptime-status:503 -->' },
        { createdAt: '2026-11-20T18:30:00Z', body: 'Still down. <!-- uptime-status:000 -->' },
        { createdAt: '2026-11-20T18:40:00Z', body: 'a human comment' },
        { createdAt: '2026-11-20T18:50:00Z', body: null },
      ]),
    ).toEqual({ code: '000', at: Date.parse('2026-11-20T18:30:00Z') });
    expect(lastMark([{ createdAt: '2026-11-20T18:00:00Z', body: 'no marker' }])).toBeNull();
    expect(lastMark([])).toBeNull();
  });
});

describe('message text', () => {
  const down: CheckResult = {
    up: false,
    code: '503',
    excerpt: '{"ok":false,"db":false}',
    path: '/readyz',
    url: 'https://vamar-owner-portal.vamar-api.workers.dev/readyz',
    attempts: 2,
    ms: 20_100,
  };

  it('stamps UTC and Dubai time', () => {
    expect(stamp(now)).toBe('2026-11-20 19:42 UTC (23:42 Dubai)');
    expect(stamp(Date.parse('2026-11-20T22:15:00Z'))).toBe('2026-11-20 22:15 UTC (02:15 Dubai)');
  });

  it('uses the title the workflow uses', () => {
    expect(issueTitle('production')).toBe('Outage: production does not answer /readyz');
  });

  it('reports the request, status, time, body and marker', () => {
    expect(downReport('production', down, now)).toBe(
      [
        '**production** did not answer `GET https://vamar-owner-portal.vamar-api.workers.dev/readyz` with 200 after 2 tries.',
        '',
        '- Status: 503 (000 means no answer or no connection)',
        '- Time: 2026-11-20 19:42 UTC (23:42 Dubai)',
        '- Checked by: the vamar-uptime Worker (Cloudflare cron, every 5 minutes)',
        '',
        'Body excerpt:',
        '',
        '```',
        '{"ok":false,"db":false}',
        '```',
        '',
        '<!-- uptime-status:503 -->',
      ].join('\n'),
    );
    expect(
      lastMark([{ createdAt: '2026-11-20T19:42:10Z', body: downReport('p', down, now) }]),
    ).toEqual({ code: '503', at: now });
  });

  it('adds the mention to new issues only when set', () => {
    expect(openBody('production', down, now, '')).toBe(downReport('production', down, now));
    expect(openBody('production', down, now, ' @someone ')).toMatch(/\n\ncc @someone$/);
    expect(stillDownComment('staging', down, now)).toMatch(/^Still down\. \*\*staging\*\*/);
  });

  it('writes the recovery comment', () => {
    const up = { ...down, up: true, code: '200', excerpt: '{"ok":true,"db":true}' };
    expect(recoveredComment('production', up, now)).toBe(
      'Recovered: **production** answers `GET https://vamar-owner-portal.vamar-api.workers.dev/readyz` with 200 again at 2026-11-20 19:42 UTC (23:42 Dubai). Checked by the vamar-uptime Worker (Cloudflare cron, every 5 minutes).',
    );
  });
});
