import {
  decide,
  issueTitle,
  lastMark,
  openBody,
  recoveredComment,
  stillDownComment,
  type Action,
} from './alerts';
import {
  checkTarget,
  DEFAULT_CHECK,
  type CheckDeps,
  type CheckOptions,
  type CheckResult,
  type Path,
} from './check';
import { isReadySlot, parseTargets, type Target } from './config';
import { appToken, GitHub, staticToken, type IssueSummary } from './github';

export interface Env {
  STATE: KVNamespace;
  /** JSON array of targets (config.ts). */
  TARGETS: unknown;
  /** "owner/name" of the repository that gets the outage issues. */
  GITHUB_REPO: string;
  /** Optional, for example a GitHub login with a leading at-sign; written into new issues. */
  UPTIME_MENTION?: string;
  /** Secrets, recommended: the GitHub App's id and private key (README). */
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  /** Secret, alternative: a fine-grained token with Issues read and write on the repository. */
  GITHUB_TOKEN?: string;
}

export interface RunDeps extends CheckDeps {
  check?: CheckOptions;
}

export type AlertMode = 'github-app' | 'github-token' | 'off';

export interface TargetStatus {
  up: boolean;
  path: Path;
  code: string;
  attempts: number;
  ms: number;
  /** Open outage issue after this run, if any. */
  issue: number | null;
  action: Action['kind'];
}

/** What the last run saw; stored in KV under STATUS_KEY and served at GET /status. */
export interface Status {
  at: string;
  scheduledTime: string;
  alerts: AlertMode;
  github: { ok: boolean; error: string | null };
  targets: Record<string, TargetStatus>;
}

export const STATUS_KEY = 'status';

/** GitHub comments older than this are not read: the last status note matters only if newer. */
const LOOKBACK_MS = 2 * 3_600_000;

export function alertMode(env: Env): AlertMode {
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) return 'github-app';
  if (env.GITHUB_TOKEN) return 'github-token';
  return 'off';
}

function gitHubFor(env: Env, mode: AlertMode, deps: RunDeps): GitHub | null {
  if (mode === 'github-app' && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
    const token = appToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      env.GITHUB_REPO,
      deps.fetch,
      deps.now,
    );
    return new GitHub(env.GITHUB_REPO, token, deps.fetch);
  }
  if (mode === 'github-token' && env.GITHUB_TOKEN) {
    return new GitHub(env.GITHUB_REPO, staticToken(env.GITHUB_TOKEN), deps.fetch);
  }
  return null;
}

function messageOf(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

export function isStatus(value: unknown): value is Status {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<Status>;
  return typeof v.at === 'string' && typeof v.targets === 'object' && typeof v.github === 'object';
}

export async function readStatus(kv: KVNamespace): Promise<Status | null> {
  const value: unknown = await kv.get(STATUS_KEY, 'json');
  return isStatus(value) ? value : null;
}

/**
 * /readyz while an issue is open or the last run saw the target down (so a database outage is not
 * "recovered" by a /healthz answer), and on the target's /readyz slot; /healthz otherwise.
 */
export function pathFor(
  target: Target,
  scheduledTime: number,
  issueOpen: boolean,
  wasDown: boolean,
): Path {
  return issueOpen || wasDown || isReadySlot(scheduledTime, target.readyEveryMinutes)
    ? '/readyz'
    : '/healthz';
}

async function alert(
  gh: GitHub,
  target: Target,
  result: CheckResult,
  issue: IssueSummary | null,
  now: number,
  mention: string,
): Promise<{ action: Action; issue: number | null }> {
  const last =
    issue && !result.up ? lastMark(await gh.entriesSince(issue, now - LOOKBACK_MS)) : null;
  const action = decide(result.up, result.code, issue ? { number: issue.number, last } : null, now);
  switch (action.kind) {
    case 'open': {
      await gh.ensureLabel();
      const number = await gh.createIssue(
        issueTitle(target.name),
        openBody(target.name, result, now, mention),
      );
      return { action, issue: number };
    }
    case 'comment':
      await gh.comment(action.issue, stillDownComment(target.name, result, now));
      return { action, issue: action.issue };
    case 'close':
      await gh.close(action.issue, recoveredComment(target.name, result, now));
      return { action, issue: null };
    case 'none':
      return { action, issue: issue?.number ?? null };
  }
}

/** One cron run: check every target, open, update or close its issue, store the status. */
export async function runOnce(env: Env, scheduledTime: number, deps: RunDeps): Promise<Status> {
  const targets = parseTargets(env.TARGETS);
  const previous = await readStatus(env.STATE);
  const mode = alertMode(env);
  const gh = gitHubFor(env, mode, deps);
  const errors: string[] = [];
  if (!gh) errors.push('no GitHub credentials (README: GitHub App)');

  let issues: IssueSummary[] | null = null;
  if (gh) {
    try {
      issues = await gh.openOutageIssues();
    } catch (e) {
      errors.push(messageOf(e));
    }
  }

  const entries = await Promise.all(
    targets.map(async (target): Promise<[string, TargetStatus]> => {
      const issue = issues?.find((i) => i.title === issueTitle(target.name)) ?? null;
      const wasDown = previous?.targets[target.name]?.up === false;
      const path = pathFor(target, scheduledTime, issue !== null, wasDown);
      const result = await checkTarget(target, path, deps, deps.check ?? DEFAULT_CHECK);
      let outcome: { action: Action; issue: number | null } = {
        action: { kind: 'none' },
        issue: issue?.number ?? null,
      };
      if (gh && issues) {
        try {
          outcome = await alert(gh, target, result, issue, deps.now(), env.UPTIME_MENTION ?? '');
        } catch (e) {
          errors.push(messageOf(e));
        }
      }
      if (!result.up) {
        console.warn(`${target.name} is down: ${result.code} ${result.url} ${result.excerpt}`);
      }
      return [
        target.name,
        {
          up: result.up,
          path,
          code: result.code,
          attempts: result.attempts,
          ms: result.ms,
          issue: outcome.issue,
          action: outcome.action.kind,
        },
      ];
    }),
  );

  const status: Status = {
    at: new Date(deps.now()).toISOString(),
    scheduledTime: new Date(scheduledTime).toISOString(),
    alerts: mode,
    github: { ok: errors.length === 0, error: errors.length === 0 ? null : errors.join('; ') },
    targets: Object.fromEntries(entries),
  };
  await env.STATE.put(STATUS_KEY, JSON.stringify(status));
  return status;
}

/** Older than this, the cron has stopped (four missed runs; KV may lag by up to a minute). */
export const STALE_MINUTES = 20;

/**
 * The monitor's own health, served at GET /readyz in the same shape as the portal's, so the
 * GitHub workflow can watch the watcher with its usual check.
 */
export function health(status: Status | null, now: number): { ok: boolean; reason: string | null } {
  if (!status) return { ok: false, reason: 'no run recorded yet' };
  const age = Math.round((now - Date.parse(status.at)) / 60_000);
  if (!(age <= STALE_MINUTES)) return { ok: false, reason: `last run ${age} min ago` };
  if (status.alerts === 'off') return { ok: false, reason: 'alerts off: no GitHub credentials' };
  if (!status.github.ok) return { ok: false, reason: `GitHub: ${status.github.error ?? 'error'}` };
  return { ok: true, reason: null };
}
