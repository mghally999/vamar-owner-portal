/**
 * The audit log shows each action in words. Every code the API writes needs a label in both
 * languages; a code the API starts writing without one would show raw (repair_approval.silence),
 * so the API sources are searched for the codes too.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, auditActionLabels } from '@/lib/audit-messages';

/** Every source file of the API, tests left out. */
function apiSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return apiSources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('audit action labels', () => {
  it('has a label for every known action in both languages', () => {
    for (const lang of ['ar', 'en'] as const) {
      // No label for a code that is not in the list either.
      expect(Object.keys(auditActionLabels[lang]).sort()).toEqual([...AUDIT_ACTIONS].sort());
    }
    for (const action of AUDIT_ACTIONS) {
      for (const lang of ['ar', 'en'] as const) {
        const label = auditActionLabels[lang][action];
        expect(label.trim(), `${lang} ${action}`).not.toBe('');
        expect(label).not.toBe(action);
      }
      expect(auditActionLabels.ar[action]).not.toBe(auditActionLabels.en[action]);
    }
  });

  it('knows every action code the API writes', () => {
    const api = fileURLToPath(new URL('../../../api/src', import.meta.url));
    const written = new Set<string>();
    for (const file of apiSources(api)) {
      // `action: 'x.y'`, also each side of `action: cond ? 'x.y' : 'x.z'`.
      for (const line of readFileSync(file, 'utf8').match(/\baction: .*/g) ?? []) {
        for (const code of line.match(/'[a-z_]+\.[a-z_]+'/g) ?? []) written.add(code.slice(1, -1));
      }
    }
    // Built from a template (`owner.${...}`), so not found by the search above.
    written.add('owner.disable');
    written.add('owner.enable');
    expect(written.size).toBeGreaterThan(60);
    expect([...written].filter((a) => !(AUDIT_ACTIONS as readonly string[]).includes(a))).toEqual(
      [],
    );
  });
});
