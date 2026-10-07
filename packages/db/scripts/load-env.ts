// Loads the repo-root .env (and a package-local one if present) so scripts work from any cwd.
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '..', '..', '..', '.env'), quiet: true });
config({ path: resolve(here, '..', '.env'), quiet: true, override: true });
