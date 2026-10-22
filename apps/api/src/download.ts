/**
 * /download: one link to send to owners. Arabic first, no JavaScript (the CSP allows none inline):
 * the Worker reads the User-Agent and puts the right option on top: Android gets the APK,
 * iPhone gets the web app at /app with the "Add to Home Screen" steps, a computer gets the QR.
 */
export type Device = 'android' | 'ios' | 'desktop';

export function detectDevice(userAgent: string | undefined): Device {
  const ua = userAgent ?? '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return 'ios';
  return 'desktop';
}

const css = `
  :root{--slate:#25323a;--slate2:#303c44;--mist:#b8b9b2;--chip:#e8e8e8;--soft:#4c575e}
  *{box-sizing:border-box}
  body{margin:0;background:#fff;color:var(--slate);font-family:'Almarai','Segoe UI',system-ui,sans-serif;line-height:1.6}
  header{background:var(--slate);color:#fff;border-radius:0 0 16px 16px;padding:40px 24px 28px;text-align:center}
  header img{height:56px;filter:invert(1)}
  header p{margin:12px 0 0;color:var(--mist);font-size:15px}
  main{max-width:520px;margin:0 auto;padding:24px 20px 48px;display:flex;flex-direction:column;gap:16px}
  .card{border:.8px solid var(--mist);border-radius:24px;padding:20px}
  .card.primary{background:var(--slate);border-color:var(--slate);color:#fff}
  .card.primary .muted{color:var(--mist)}
  h2{margin:0 0 6px;font-size:17px}
  .muted{color:var(--soft);font-size:14px;margin:0}
  .btn{display:block;margin-top:16px;text-align:center;padding:14px 16px;border-radius:20px;font-weight:700;text-decoration:none;font-size:16px}
  .card.primary .btn{background:#fff;color:var(--slate)}
  .card:not(.primary) .btn{background:var(--slate);color:#fff}
  ol{margin:12px 0 0;padding-inline-start:20px;font-size:14px}
  .qr{display:block;margin:16px auto 0;width:200px;height:200px}
  .en{direction:ltr;text-align:left}
  footer{text-align:center;font-size:13px;color:var(--soft)}
  footer a{color:inherit}
`;

export function downloadPage(device: Device, version: string): string {
  const android = `
    <section class="card${device === 'android' ? ' primary' : ''}">
      <h2>أندرويد</h2>
      <p class="muted">نزّل التطبيق وافتح الملف، ثم اسمح بالتثبيت من هذا المصدر إذا طلب الهاتف ذلك.</p>
      <p class="muted en">Android: download, open the file, allow installs from this source if asked.</p>
      <a class="btn" href="/download/vamar-owner-app.apk">تنزيل التطبيق · Download (APK)</a>
    </section>`;
  const ios = `
    <section class="card${device === 'ios' ? ' primary' : ''}">
      <h2>آيفون</h2>
      <p class="muted">افتح تطبيق الويب في Safari ثم أضفه إلى الشاشة الرئيسية ليعمل مثل أي تطبيق.</p>
      <ol>
        <li>اضغط زر المشاركة أسفل Safari.</li>
        <li>اختر «إضافة إلى الشاشة الرئيسية».</li>
        <li>اضغط «إضافة».</li>
      </ol>
      <p class="muted en">iPhone: open the web app in Safari, tap Share, then "Add to Home Screen".</p>
      <a class="btn" href="/app">افتح تطبيق الويب · Open the web app</a>
    </section>`;
  const qr = `
    <section class="card${device === 'desktop' ? ' primary' : ''}">
      <h2>من الكمبيوتر</h2>
      <p class="muted">امسح الرمز بكاميرا الهاتف لفتح هذه الصفحة عليه.</p>
      <p class="muted en">On a computer: scan the code with your phone's camera.</p>
      <img class="qr" src="/download-qr.svg" alt="QR: vamar-owner-portal.vamar-api.workers.dev/download">
    </section>`;
  const order =
    device === 'android'
      ? [android, ios, qr]
      : device === 'ios'
        ? [ios, android, qr]
        : [qr, android, ios];
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#25323a">
<title>تطبيق ملاك فامار | Vamar Owner App</title>
<link rel="stylesheet" href="/fonts/almarai.css">
<style>${css}</style>
</head>
<body>
<header>
  <img src="/vamar-logo.svg" alt="Vamar Real Estate">
  <p>تطبيق ملاك فامار: شيكاتك ووحداتك ومنازعاتك في جيبك</p>
</header>
<main>
  ${order.join('\n')}
  <footer>الإصدار ${version} · <a href="/privacy">سياسة الخصوصية</a></footer>
</main>
</body>
</html>`;
}
