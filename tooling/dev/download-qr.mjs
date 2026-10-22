#!/usr/bin/env node
/**
 * Writes the QR code for the owners' download page in two forms:
 * apps/dashboard/public/download-qr.svg (shown on /download) and demo/download-qr.png (to print or
 * send). Usage: node tooling/dev/download-qr.mjs [url]
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'apps', 'dashboard', 'package.json'));
const QRCode = require('qrcode');
const url = process.argv[2] ?? 'https://vamar-owner-portal.vamar-api.workers.dev/download';
const opts = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#25323a', light: '#ffffff' } };
await QRCode.toFile(join('apps', 'dashboard', 'public', 'download-qr.svg'), url, {
  ...opts,
  type: 'svg',
});
await QRCode.toFile(join('demo', 'download-qr.png'), url, { ...opts, width: 1024 });
console.log(`QR for ${url} written`);
