/**
 * The web app is served under a base URL (app.config.ts `experiments.baseUrl`, `/app`). When it
 * reads a path, expo-router removes the base URL with `^/?<baseUrl>` and no segment boundary, so
 * an in-app link to a route whose path starts with the same letters loses them: `/approvals`
 * became `/rovals` ("Unmatched Route") when an owner tapped the approvals banner in the web app.
 * No route may start with the base URL's text.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..');

function baseUrl(): string {
  const m = /baseUrl:\s*'([^']+)'/.exec(readFileSync(join(root, 'app.config.ts'), 'utf8'));
  if (!m?.[1]) throw new Error('experiments.baseUrl not found in app.config.ts');
  return m[1];
}

/** Every route path under app/, as the router sees it (groups like `(tabs)` removed). */
function routePaths(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const segment = /^\(.*\)$/.test(name) ? '' : name.replace(/\.tsx?$/, '');
    if (statSync(full).isDirectory()) {
      out.push(...routePaths(full, segment ? `${prefix}/${segment}` : prefix));
    } else if (/\.tsx?$/.test(name) && !name.startsWith('_') && !name.startsWith('+')) {
      out.push(segment === 'index' ? prefix || '/' : `${prefix}/${segment}`);
    }
  }
  return out;
}

describe('routes and the web base URL', () => {
  const base = baseUrl();
  const paths = routePaths(join(root, 'app'));

  it('finds the routes', () => {
    expect(base).toBe('/app');
    expect(paths).toContain('/repair-approvals');
    expect(paths).toContain('/messages');
  });

  it('has no route path that the base URL stripping would cut', () => {
    const strip = new RegExp(`^/?${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`);
    const cut = paths.filter((p) => p.replace(strip, '') !== p);
    expect(cut).toEqual([]);
  });

  it('would have caught the old approvals routes', () => {
    const strip = new RegExp(`^/?${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`);
    expect('/approvals'.replace(strip, '')).toBe('rovals');
  });
});
