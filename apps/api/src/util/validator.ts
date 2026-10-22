/**
 * zod validation with one error envelope. Every route uses this instead of `@hono/zod-validator`
 * directly so a bad body, query or param returns the same `422 { error: { code: 'validation',
 * details } }` shape as every other API error.
 */
import { zValidator as base } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import { validation } from '../errors.js';

export function zValidator<T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return base(target, schema, (result) => {
    if (!result.success) {
      throw validation(
        'Invalid request',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
  });
}
