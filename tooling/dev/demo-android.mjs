#!/usr/bin/env node
/**
 * One command for the Android demo:
 *   1. PostgreSQL, Firebase Auth emulator and the API (same as `pnpm dev`, without Vite)
 *   2. Android emulator (AVD from ANDROID_AVD, default Vamar_Demo), waits until it has booted
 *   3. Metro in dev-client mode, opening the installed Vamar dev build on the emulator
 *
 * Nothing here is machine specific: the SDK comes from ANDROID_HOME (or ANDROID_SDK_ROOT, or
 * the default %LOCALAPPDATA%\Android\Sdk on Windows). The dev build must already be installed
 * once with `pnpm --filter @vamar/mobile android` (see DEMO.md).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs, { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const isWin = process.platform === 'win32';
const avd = process.env.ANDROID_AVD ?? 'Vamar_Demo';
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  (isWin
    ? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
    : join(process.env.HOME ?? '', 'Android', 'Sdk'));
const exe = (p) => (isWin ? `${p}.exe` : p);
const emulatorBin = join(sdk, 'emulator', exe('emulator'));
const adbBin = join(sdk, 'platform-tools', exe('adb'));

if (!existsSync(emulatorBin) || !existsSync(adbBin)) {
  console.error(`Android SDK not found at ${sdk}. Set ANDROID_HOME (see DEMO.md).`);
  process.exit(1);
}
process.env.ANDROID_HOME = sdk;
process.env.PATH = `${join(sdk, 'platform-tools')}${isWin ? ';' : ':'}${process.env.PATH}`;

const children = [];
function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
  child.on('exit', (code) => console.log(`[${name}] exited with ${code}`));
  children.push(child);
  return child;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function portOpen(port, host = '127.0.0.1') {
  return new Promise((res) => {
    const s = createConnection({ port, host });
    s.once('connect', () => (s.destroy(), res(true)));
    s.once('error', () => res(false));
    s.setTimeout(800, () => (s.destroy(), res(false)));
  });
}

// 1. Database, Firebase emulator, API (reuses the normal dev starter)
run('stack', process.execPath, [
  join(root, 'tooling', 'dev', 'start.mjs'),
  'db',
  'firebase',
  'api',
]);

// 2. Emulator
const adb = (...args) => spawnSync(adbBin, args, { encoding: 'utf8' });
const devices = () =>
  (adb('devices').stdout ?? '')
    .split('\n')
    .slice(1)
    .filter((l) => /\tdevice$/.test(l.trim()))
    .map((l) => l.split('\t')[0]);

let serial = devices().find((d) => d.startsWith('emulator-'));
if (serial) console.log(`[emulator] already running (${serial})`);
else {
  const avds = (spawnSync(emulatorBin, ['-list-avds'], { encoding: 'utf8' }).stdout ?? '').trim();
  if (!avds.split(/\r?\n/).includes(avd)) {
    console.error(`[emulator] AVD "${avd}" not found. Available: ${avds || 'none'}. See DEMO.md.`);
    process.exit(1);
  }
  // Window: the emulator remembers position and zoom in emulator-user.ini; a Pixel 7 at 1:1 is
  // taller than a laptop screen, so pin it to the top-left at 30 % (about 324 x 720 px).
  const avdHome =
    process.env.ANDROID_AVD_HOME ??
    join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.android', 'avd');
  const userIni = join(avdHome, `${avd}.avd`, 'emulator-user.ini');
  try {
    const scale = process.env.ANDROID_EMULATOR_SCALE ?? '0.3';
    fs.writeFileSync(
      userIni,
      `window.x=24
window.y=8
window.scale=${scale}
`,
    );
  } catch {
    // not fatal: the emulator falls back to its own window placement
  }
  // 2 GB RAM and no snapshot load keep the emulator usable on an 8 GB laptop.
  run(
    'emulator',
    emulatorBin,
    [
      '-avd',
      avd,
      '-memory',
      '2048',
      '-no-snapshot-load',
      '-no-boot-anim',
      '-cores',
      '4',
      '-gpu',
      'swiftshader_indirect',
    ],
    {
      cwd: join(sdk, 'emulator'),
    },
  );
  for (let i = 0; i < 180 && !serial; i++) {
    await sleep(2000);
    serial = devices().find((d) => d.startsWith('emulator-'));
  }
  if (!serial) {
    console.error('[emulator] did not appear in `adb devices` within 6 minutes');
    process.exit(1);
  }
}
for (let i = 0; i < 180; i++) {
  const booted = (adb('-s', serial, 'shell', 'getprop', 'sys.boot_completed').stdout ?? '').trim();
  if (booted === '1') break;
  await sleep(2000);
}
console.log(`[emulator] ${serial} booted`);
if (isWin) {
  // Put the window fully on screen (the emulator's remembered position can be off-screen).
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(root, 'tooling', 'dev', 'win-place-emulator.ps1'),
    ],
    { encoding: 'utf8' },
  );
  console.log(`[emulator] ${(r.stdout ?? '').trim() || 'window placement skipped'}`);
}
// The app talks to 10.0.2.2 (the host) for the API and the Auth emulator; nothing to forward.

// 3. Metro, once the API answers
for (let i = 0; i < 60 && !(await portOpen(8787)); i++) await sleep(1000);
run('metro', isWin ? 'npx.cmd' : 'npx', ['expo', 'start', '--dev-client', '--android'], {
  cwd: join(root, 'apps', 'mobile'),
  shell: isWin,
});

console.log(
  '\nAPI: http://localhost:8787   Firebase UI: http://localhost:4000   Emulator: ' + serial + '\n',
);

function shutdown() {
  for (const c of children) {
    try {
      if (isWin) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
