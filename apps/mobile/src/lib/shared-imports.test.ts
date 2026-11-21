import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as lean from './shared';

const root = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === '__tests__' || name === 'test' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every import or re-export of the package index that is not type-only. */
function valueImportsOfIndex(code: string): string[] {
  const statements = code.match(/^(?:import|export)\b[^;]*?from\s+'@vamar\/shared';/gms) ?? [];
  return statements.filter((s) => !/^(?:import|export)\s+type\b/.test(s));
}

describe('the app and @vamar/shared', () => {
  it('never loads the package index (and with it zod) at run time', () => {
    const offenders = [...sources(join(root, 'app')), ...sources(join(root, 'src'))]
      .filter((file) => valueImportsOfIndex(readFileSync(file, 'utf8')).length > 0)
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });

  it('spots a value import, mixed or multi-line, and lets type-only ones through', () => {
    expect(valueImportsOfIndex("import { a, type B } from '@vamar/shared';")).toHaveLength(1);
    expect(valueImportsOfIndex("import {\n  a,\n  b,\n} from '@vamar/shared';")).toHaveLength(1);
    expect(valueImportsOfIndex("import type { B } from '@vamar/shared';")).toHaveLength(0);
    expect(valueImportsOfIndex("export type { B } from '@vamar/shared';")).toHaveLength(0);
    expect(valueImportsOfIndex("import { a } from './shared';")).toHaveLength(0);
  });

  it('offers the rules the screens use, without any zod schema', () => {
    expect(typeof lean.formatAmount).toBe('function');
    expect(typeof lean.monthGrid).toBe('function');
    expect(lean.CHEQUE_STATUSES).toContain('bounced');
    expect(lean.EXPENSE_KIND_LABEL.fixed.en).toBeTruthy();
    expect(Object.keys(lean).filter((k) => k.endsWith('Schema'))).toEqual([]);
  });
});
