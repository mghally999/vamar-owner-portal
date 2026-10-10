#!/usr/bin/env node
/**
 * Store screenshots from the emulator captures in demo/screenshots/app (720 x 1600):
 *   demo/screenshots/store/play/*.png     1080 x 2400  (Google Play phone)
 *   demo/screenshots/store/ios-6.7/*.png  1290 x 2796  (App Store 6.7")
 *   demo/screenshots/store/ios-6.5/*.png  1284 x 2778  (App Store 6.5")
 * The phone frame is 9:20; the iOS canvases are slightly different ratios, so the capture is
 * scaled to fit and letterboxed with the app background colour. Arabic captures come first.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
  '..',
);
const src = path.join(root, 'demo', 'screenshots', 'app');
const out = path.join(root, 'demo', 'screenshots', 'store');
const targets = [
  { dir: 'play', w: 1080, h: 2400 },
  { dir: 'ios-6.7', w: 1290, h: 2796 },
  { dir: 'ios-6.5', w: 1284, h: 2778 },
];
const order = [
  '01-login',
  '03-home',
  '04-cheques',
  '05-cheque-detail',
  '06-properties',
  '07-unit-detail',
  '08-disputes',
  '09-dispute-detail',
  '10-settings',
];
const files = fs
  .readdirSync(src)
  .filter(
    (f) =>
      f.endsWith('.png') &&
      !f.includes('dark') &&
      !f.includes('otp') &&
      !f.includes('not-registered') &&
      !f.includes('account'),
  )
  .sort((a, b) => {
    const ia = order.findIndex((o) => a.startsWith(o));
    const ib = order.findIndex((o) => b.startsWith(o));
    const la = a.includes('-ar') ? 0 : 1;
    const lb = b.includes('-ar') ? 0 : 1;
    return la - lb || ia - ib || a.localeCompare(b);
  });

for (const t of targets) fs.mkdirSync(path.join(out, t.dir), { recursive: true });
let n = 0;
for (const f of files) {
  const index = String(++n).padStart(2, '0');
  const input = path.join(src, f);
  const meta = await sharp(input).metadata();
  const isDark = f.includes('dark');
  const bg = isDark ? { r: 10, g: 24, b: 41 } : { r: 245, g: 244, b: 239 };
  for (const t of targets) {
    const scale = Math.min(t.w / meta.width, t.h / meta.height);
    const w = Math.round(meta.width * scale);
    const h = Math.round(meta.height * scale);
    const resized = await sharp(input).resize(w, h, { kernel: 'lanczos3' }).toBuffer();
    const name = `${index}-${f}`;
    await sharp({ create: { width: t.w, height: t.h, channels: 3, background: bg } })
      .composite([
        { input: resized, left: Math.round((t.w - w) / 2), top: Math.round((t.h - h) / 2) },
      ])
      .png()
      .toFile(path.join(out, t.dir, name));
  }
}
console.log(`wrote ${files.length} captures x ${targets.length} sizes into demo/screenshots/store`);
