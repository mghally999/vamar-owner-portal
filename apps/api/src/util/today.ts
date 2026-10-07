import { assertPlainDate, todayInDubai, type PlainDate } from '@vamar/shared';
import type { Bindings } from '../env.js';

/** Business "today" in Asia/Dubai; tests may pin it through TEST_TODAY. */
export function today(env: Bindings): PlainDate {
  return env.TEST_TODAY ? assertPlainDate(env.TEST_TODAY) : todayInDubai();
}
