/**
 * Monthly / yearly statement PDF generated on the device with expo-print (no server CPU).
 * Almarai is embedded as base64 so Arabic renders identically everywhere.
 */
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { statementHtml, type StatementInput } from './statement-html';

export { periodLabel, statementHtml, type StatementInput } from './statement-html';

let fontCache: string | null = null;

async function fontBase64(): Promise<string> {
  if (fontCache) return fontCache;
  const asset = Asset.fromModule(
    require('../../../../packages/tokens/assets/fonts/Almarai-Regular.ttf'),
  );
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  fontCache = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  return fontCache;
}

export async function shareStatement(input: StatementInput): Promise<void> {
  await sharePeriodStatementHtml((fontSrc) => statementHtml(input, fontSrc), input.periodLabel);
}

/** Renders the HTML with the embedded font to a PDF and opens the share sheet. */
export async function sharePeriodStatementHtml(
  html: (fontSrc: string) => string,
  label: string,
): Promise<void> {
  const { uri } = await Print.printToFileAsync({
    html: html(`url(data:font/ttf;base64,${await fontBase64()}) format('truetype')`),
    base64: false,
  });
  const name = `vamar-statement-${label.replace(/[\s–]+/g, '-')}.pdf`;
  const dest = `${FileSystem.cacheDirectory ?? ''}${name}`;
  try {
    await FileSystem.moveAsync({ from: uri, to: dest });
  } catch {
    // keep original uri
  }
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(dest, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
