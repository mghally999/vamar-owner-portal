#!/usr/bin/env node
/**
 * Backup restore drill: node tooling/ops/restore-drill.mjs <sourceDatabaseUrl> <ageIdentityFile> [encryptedDump]
 *
 * Without a dump file it first makes one exactly like .github/workflows/backup.yml does
 * (pg_dump --no-owner --no-privileges | gzip -9 | age -r <recipient>). Then it decrypts, restores
 * into a fresh local database `vamar_restore_drill` and compares row counts table by table with
 * the source. Prints the timings that go into PROJECT.md. Needs pg_dump/psql 17 and age on PATH
 * (or PG_BIN pointing at the PostgreSQL bin folder). Never writes to the source.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'packages', 'db', 'package.json'));
const { Client } = require('pg');

const [source, identityFile, dumpArg] = process.argv.slice(2);
if (!source || !identityFile) {
  console.error('usage: restore-drill.mjs <sourceDatabaseUrl> <ageIdentityFile> [encryptedDump]');
  process.exit(2);
}
const bin = (name) => (process.env.PG_BIN ? join(process.env.PG_BIN, name) : name);
const TARGET_DB = 'vamar_restore_drill';
const localAdmin = process.env.LOCAL_ADMIN_URL ?? 'postgres://vamar:vamar@localhost:5433/postgres';
const work = mkdtempSync(join(tmpdir(), 'vamar-drill-'));
const t = () => performance.now();
const ms = (a) => `${Math.round(t() - a)} ms`;

try {
  const recipient = /public key: (age1\w+)/.exec(readFileSync(identityFile, 'utf8'))?.[1];
  if (!recipient) throw new Error('no "public key:" line in the identity file');

  let encrypted = dumpArg;
  if (!encrypted) {
    const t0 = t();
    const sql = execFileSync(
      bin('pg_dump'),
      ['--no-owner', '--no-privileges', '--format=plain', source],
      {
        maxBuffer: 1024 * 1024 * 1024,
      },
    );
    const gz = gzipSync(sql, { level: 9 });
    encrypted = join(work, 'drill.sql.gz.age');
    execFileSync('age', ['--recipient', recipient, '--output', encrypted], { input: gz });
    console.log(
      `dump: ${sql.length} bytes sql, ${statSync(encrypted).size} bytes encrypted (${ms(t0)})`,
    );
  }

  const t1 = t();
  const gz = execFileSync('age', ['--decrypt', '--identity', identityFile, encrypted], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  const sql = gunzipSync(gz);
  console.log(`decrypt + gunzip: ${sql.length} bytes (${ms(t1)})`);

  const admin = new Client({ connectionString: localAdmin });
  await admin.connect();
  await admin.query(`drop database if exists ${TARGET_DB}`);
  await admin.query(`create database ${TARGET_DB}`);
  await admin.end();
  const targetUrl = localAdmin.replace(/\/[^/]+$/, `/${TARGET_DB}`);

  const t2 = t();
  const r = spawnSync(bin('psql'), ['-q', '-v', 'ON_ERROR_STOP=0', targetUrl], {
    input: sql,
    maxBuffer: 1024 * 1024 * 1024,
  });
  const errors = String(r.stderr)
    .split('\n')
    .filter(
      (l) => /ERROR/.test(l) && !/role .* does not exist|extension .* already exists/.test(l),
    );
  console.log(
    `restore: ${ms(t2)}, ${errors.length} errors${errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''}`,
  );

  const counts = async (url) => {
    const c = new Client({ connectionString: url });
    await c.connect();
    const tables = await c.query(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    );
    const out = {};
    for (const { table_name } of tables.rows) {
      out[table_name] = (await c.query(`select count(*)::int n from "${table_name}"`)).rows[0].n;
    }
    await c.end();
    return out;
  };
  const [a, b] = await Promise.all([counts(source), counts(targetUrl)]);
  let mismatches = 0;
  for (const table of Object.keys(a)) {
    const same = a[table] === b[table];
    if (!same) mismatches++;
    console.log(
      `${same ? 'ok ' : 'XX '} ${table.padEnd(18)} source ${String(a[table]).padStart(6)}  restored ${String(b[table] ?? '-').padStart(6)}`,
    );
  }
  console.log(
    mismatches === 0 && errors.length === 0 ? 'RESTORE DRILL PASSED' : 'RESTORE DRILL FAILED',
  );
  process.exitCode = mismatches === 0 && errors.length === 0 ? 0 : 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
