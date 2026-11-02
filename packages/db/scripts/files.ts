// Demo attachments written by the seed: locally into the API's file folder (the same layout the
// dev server's folder bucket reads), or into DEMO_FILES_DIR to upload to R2 afterwards.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedFiles } from '../src/seed/index.js';

const here = dirname(fileURLToPath(import.meta.url));

export function demoFilesDir(): string {
  return (
    process.env['DEMO_FILES_DIR'] ?? resolve(here, '..', '..', '..', 'apps', 'api', '.dev-files')
  );
}

export function demoFilesHook(dir = demoFilesDir()): SeedFiles {
  return async (key, bytes, mime) => {
    const p = join(dir, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    await writeFile(`${p}.meta.json`, JSON.stringify({ contentType: mime }));
  };
}
