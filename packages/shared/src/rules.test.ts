import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as everything from './index.js';
import * as rules from './rules.js';
import * as schemas from './schemas/index.js';

const src = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(src, '..', 'package.json'), 'utf8')) as {
  exports: Record<string, string | { types: string; default: string }>;
  sideEffects: boolean;
};

/** Run-time imports of a module (`import type` and `export type` lines are erased by bundlers). */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /^(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  for (const m of text.matchAll(re)) if (m[1]) out.push(m[1]);
  return out;
}

/** Every file the module reaches at run time, and the bare packages it imports. */
function graph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const spec of runtimeImports(file)) {
      if (!spec.startsWith('.')) {
        packages.add(spec);
        continue;
      }
      const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'));
      expect(existsSync(target), `${relative(src, file)} imports ${spec}`).toBe(true);
      visit(target);
    }
  };
  visit(entry);
  return { files, packages };
}

describe('@vamar/shared/rules', () => {
  it('reaches no zod and no schema module at run time', () => {
    const { files, packages } = graph(join(src, 'rules.ts'));
    expect([...packages]).toEqual([]);
    const schemaFiles = [...files]
      .map((f) => relative(src, f))
      .filter((f) => f.includes('schemas'));
    expect(schemaFiles).toEqual([]);
  });

  it('is the index without the schemas: nothing is lost or exported twice', () => {
    const fromRules = Object.keys(rules);
    const fromSchemas = Object.keys(schemas);
    expect(fromRules.filter((k) => fromSchemas.includes(k))).toEqual([]);
    expect(Object.keys(everything).sort()).toEqual([...fromRules, ...fromSchemas].sort());
  });

  it('every rule module is in the rules entry', () => {
    const { files } = graph(join(src, 'rules.ts'));
    const reached = new Set([...files].map((f) => relative(src, f).replaceAll('\\', '/')));
    const listed = runtimeImports(join(src, 'rules.ts')).map((s) => s.replace(/^\.\/|\.js$/g, ''));
    for (const file of reached) {
      if (file === 'rules.ts') continue;
      expect(listed, `${file} is reachable but not re-exported`).toContain(
        file.replace(/\.ts$/, ''),
      );
    }
  });
});

describe('package.json exports', () => {
  const target = (key: string) => {
    const entry = pkg.exports[key];
    return typeof entry === 'string' ? entry : entry?.default;
  };

  it('points every explicit entry at a file that exists, types and code alike', () => {
    for (const [key, entry] of Object.entries(pkg.exports)) {
      if (key.includes('*')) continue;
      const paths = typeof entry === 'string' ? [entry] : [entry.types, entry.default];
      for (const p of paths) expect(existsSync(join(src, '..', p)), `${key} -> ${p}`).toBe(true);
    }
  });

  it('serves the index, the rules, the schemas and single modules', () => {
    expect(target('.')).toBe('./src/index.ts');
    expect(target('./rules')).toBe('./src/rules.ts');
    expect(target('./schemas')).toBe('./src/schemas/index.ts');
    // `@vamar/shared/dates`, `@vamar/shared/i18n/labels`, `@vamar/shared/schemas/v2`, ...
    expect(target('./*')).toBe('./src/*.ts');
    for (const name of ['dates', 'money', 'phone', 'i18n/labels', 'schemas/v2'])
      expect(existsSync(join(src, `${name}.ts`)), name).toBe(true);
  });

  it('declares the package free of side effects, so bundlers drop what is not used', () => {
    expect(pkg.sideEffects).toBe(false);
  });
});
