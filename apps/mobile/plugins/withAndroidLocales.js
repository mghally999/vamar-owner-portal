// Expo's `locales` config writes the iOS keys (CFBundleDisplayName, NSFaceIDUsageDescription...)
// verbatim into Android's values-b+xx/strings.xml, and Android lint then fails the release build
// with ExtraTranslation ("translated here but not found in default locale"). This plugin rewrites
// each generated locale file (in the finalized phase, after the built-in writer) so Android only
// gets what it understands: the localised app_name.
const { withFinalizedMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withAndroidLocales(config) {
  return withFinalizedMod(config, [
    'android',
    (cfg) => {
      const resDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      const locales = cfg.locales ?? {};
      for (const [lang, file] of Object.entries(locales)) {
        const source =
          typeof file === 'string' ? path.join(cfg.modRequest.projectRoot, file) : null;
        if (!source || !fs.existsSync(source)) continue;
        const strings = JSON.parse(fs.readFileSync(source, 'utf8'));
        const appName = strings.CFBundleDisplayName;
        const dir = path.join(resDir, `values-b+${lang}`);
        fs.mkdirSync(dir, { recursive: true });
        const xml = appName
          ? `<resources>\n  <string name="app_name">${escapeXml(appName)}</string>\n</resources>\n`
          : '<resources/>\n';
        fs.writeFileSync(path.join(dir, 'strings.xml'), xml);
      }
      return cfg;
    },
  ]);
};

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}
