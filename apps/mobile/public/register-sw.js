/* global window */
// Registers the offline shell (a separate file: the page's CSP allows no inline script).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => undefined);
  });
}
