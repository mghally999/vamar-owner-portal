/**
 * A message arrives as JSON, or as a multipart form when it carries a file (one per message, so
 * the request stays under the upload body limit). Both are read into the same zod schema.
 */
import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from '../env.js';
import { validation } from '../errors.js';

export async function readMessageInput<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T,
): Promise<{ input: z.output<T>; file: File | null }> {
  let raw: unknown;
  let file: File | null = null;
  if ((c.req.header('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await c.req.formData();
    const fields: Record<string, string> = {};
    const files: File[] = [];
    for (const [key, value] of form.entries()) {
      if (typeof value !== 'string') files.push(value);
      else if (key !== 'file') fields[key] = value;
    }
    if (files.length > 1) throw validation('One file per message');
    file = files[0] ?? null;
    raw = fields;
  } else {
    try {
      raw = await c.req.json();
    } catch {
      throw validation('Invalid JSON body');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw validation(
      'Invalid request',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  return { input: parsed.data, file };
}
