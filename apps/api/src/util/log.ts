/** Structured logging that never leaks tokens, OTPs or full phone numbers. */

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return `${'*'.repeat(Math.max(0, phone.length - 3))}${phone.slice(-3)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

type Level = 'info' | 'warn' | 'error';

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/token|secret|otp|code|password|authorization/i.test(k)) continue;
    safe[k] = v;
  }
  const line = JSON.stringify({ level, event, ...safe, at: new Date().toISOString() });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
