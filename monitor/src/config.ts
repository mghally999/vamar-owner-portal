/** Minutes between cron runs (wrangler.jsonc `triggers.crons`). */
export const CRON_MINUTES = 5;

export interface Target {
  /** Name used in issue titles and in the status: "production", "staging". */
  name: string;
  /** Origin without a trailing slash, for example https://vamar-owner-portal.vamar-api.workers.dev */
  base: string;
  /**
   * Minutes between /readyz checks. /readyz runs `select 1` and so wakes the Neon compute, which
   * then stays up for 5 minutes and spends the free plan's compute hours; the runs in between call
   * /healthz, which answers from the Worker alone. A multiple of CRON_MINUTES.
   */
  readyEveryMinutes: number;
}

interface RawTarget {
  name?: unknown;
  base?: unknown;
  readyEveryMinutes?: unknown;
}

/** TARGETS from wrangler.jsonc `vars`: a JSON array (wrangler passes it parsed, or as a string). */
export function parseTargets(raw: unknown): Target[] {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('TARGETS must be a non-empty array');
  }
  const names = new Set<string>();
  return value.map((item: unknown, i) => {
    if (typeof item !== 'object' || item === null)
      throw new Error(`TARGETS[${i}] is not an object`);
    const { name, base, readyEveryMinutes } = item as RawTarget;
    if (typeof name !== 'string' || !/^[a-z][a-z0-9 -]*$/.test(name) || names.has(name)) {
      throw new Error(`TARGETS[${i}].name must be a unique lower-case name`);
    }
    if (typeof base !== 'string' || !/^https:\/\/[^/\s]+$/.test(base)) {
      throw new Error(`TARGETS[${i}].base must be an https origin without a path`);
    }
    if (
      typeof readyEveryMinutes !== 'number' ||
      !Number.isInteger(readyEveryMinutes) ||
      readyEveryMinutes < CRON_MINUTES ||
      readyEveryMinutes % CRON_MINUTES !== 0
    ) {
      throw new Error(`TARGETS[${i}].readyEveryMinutes must be a multiple of ${CRON_MINUTES}`);
    }
    names.add(name);
    return { name, base, readyEveryMinutes };
  });
}

/**
 * True on the one cron run in every `everyMinutes` that checks /readyz. `scheduledTime` is the
 * cron's planned time (a whole multiple of CRON_MINUTES), not the moment the run started, so a late
 * start does not skip or double the slot.
 */
export function isReadySlot(scheduledTime: number, everyMinutes: number): boolean {
  const minute = Math.floor(scheduledTime / 60_000);
  return minute % everyMinutes < CRON_MINUTES;
}
