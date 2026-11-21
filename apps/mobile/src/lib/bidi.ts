/**
 * Keeps a left-to-right run (a phone number, a code) whole inside Arabic text. Without the
 * isolate the leading "+" of "+971..." follows the Arabic direction and lands on the wrong side.
 */
export function ltr(text: string): string {
  return `⁦${text}⁩`;
}
