import type { CheckResult } from './check';

/**
 * Issue titles, the label and the `uptime-status` marker are shared with
 * .github/workflows/uptime.yml, so either monitor can pick up an issue the other one opened.
 */
export const LABEL = 'outage';

/** While a target stays down with the same status, a new comment at most this often. */
export const RENOTIFY_MINUTES = 55;

export function issueTitle(name: string): string {
  return `Outage: ${name} does not answer /readyz`;
}

export interface StatusMark {
  code: string;
  at: number;
}

export interface OpenIssue {
  number: number;
  /** Last status written on the issue by a monitor; null when none was found. */
  last: StatusMark | null;
}

export type Action =
  | { kind: 'none' }
  | { kind: 'open' }
  | { kind: 'comment'; issue: number }
  | { kind: 'close'; issue: number };

/**
 * The open issue is the alert state: no issue while up, one open issue while down. Opening and
 * closing it are the two alerts (GitHub e-mails repository watchers); while down, a comment when
 * the status changes and at most every RENOTIFY_MINUTES otherwise.
 */
export function decide(up: boolean, code: string, issue: OpenIssue | null, now: number): Action {
  if (up) return issue ? { kind: 'close', issue: issue.number } : { kind: 'none' };
  if (!issue) return { kind: 'open' };
  const last = issue.last;
  if (last?.code !== code || now - last.at >= RENOTIFY_MINUTES * 60_000) {
    return { kind: 'comment', issue: issue.number };
  }
  return { kind: 'none' };
}

const MARK = /uptime-status:(\d+)/;

/** Newest `<!-- uptime-status:NNN -->` among the issue body and its comments. */
export function lastMark(
  entries: readonly { createdAt: string; body: string | null }[],
): StatusMark | null {
  let best: StatusMark | null = null;
  for (const entry of entries) {
    const code = MARK.exec(entry.body ?? '')?.[1];
    const at = Date.parse(entry.createdAt);
    if (code === undefined || Number.isNaN(at)) continue;
    if (!best || at >= best.at) best = { code, at };
  }
  return best;
}

/** "2026-11-20 19:42 UTC (23:42 Dubai)". Dubai is UTC+4 all year (no daylight saving). */
export function stamp(ms: number): string {
  const utc = new Date(ms).toISOString();
  const dubai = new Date(ms + 4 * 3_600_000).toISOString().slice(11, 16);
  return `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC (${dubai} Dubai)`;
}

const SOURCE = 'the vamar-uptime Worker (Cloudflare cron, every 5 minutes)';

export function downReport(name: string, r: CheckResult, now: number): string {
  const tries = r.attempts === 1 ? '1 try' : `${r.attempts} tries`;
  return [
    `**${name}** did not answer \`GET ${r.url}\` with 200 after ${tries}.`,
    '',
    `- Status: ${r.code} (000 means no answer or no connection)`,
    `- Time: ${stamp(now)}`,
    `- Checked by: ${SOURCE}`,
    '',
    'Body excerpt:',
    '',
    '```',
    r.excerpt,
    '```',
    '',
    `<!-- uptime-status:${r.code} -->`,
  ].join('\n');
}

export function openBody(name: string, r: CheckResult, now: number, mention: string): string {
  const report = downReport(name, r, now);
  return mention.trim() === '' ? report : `${report}\n\ncc ${mention.trim()}`;
}

export function stillDownComment(name: string, r: CheckResult, now: number): string {
  return `Still down. ${downReport(name, r, now)}`;
}

export function recoveredComment(name: string, r: CheckResult, now: number): string {
  return `Recovered: **${name}** answers \`GET ${r.url}\` with 200 again at ${stamp(now)}. Checked by ${SOURCE}.`;
}
