/**
 * Phone numbers: owners sign in with their mobile number, so the API, the dashboard (owner form,
 * import) and the app (sign-in screen) must agree on what a valid number is and how typed text
 * becomes E.164. Plain functions without zod, so the app can use them without the schemas.
 */

/** International calling codes of the countries an owner's sign-in phone may belong to. */
export const PHONE_COUNTRY_PREFIX: Readonly<Record<string, string>> = {
  AE: '+971',
  SA: '+966',
  QA: '+974',
  KW: '+965',
  BH: '+973',
  OM: '+968',
  EG: '+20',
  GB: '+44',
  US: '+1',
  IN: '+91',
  PK: '+92',
};

/** A UAE mobile number in E.164: +971 5X XXX XXXX. */
export const UAE_MOBILE_RE = /^\+9715\d{8}$/;

/** Mobile number shapes we check; a listed country without one only needs its prefix. */
const MOBILE_SHAPE: Readonly<Record<string, RegExp>> = { AE: UAE_MOBILE_RE };

/** `"AE, SA"` (the ALLOWED_PHONE_COUNTRIES variable) to `['AE', 'SA']`. */
export function parseCountryList(list: string): string[] {
  return list
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** Whether an E.164 phone is a mobile number of one of the countries (`*` allows any). */
export function phoneInCountries(phone: string, countries: readonly string[]): boolean {
  if (countries.includes('*')) return true;
  return countries.some((cc) => {
    const prefix = PHONE_COUNTRY_PREFIX[cc];
    if (!prefix || !phone.startsWith(prefix)) return false;
    return MOBILE_SHAPE[cc]?.test(phone) ?? true;
  });
}

export function isUaeMobile(phone: string): boolean {
  return UAE_MOBILE_RE.test(phone);
}

export const UAE_MOBILE_MESSAGE =
  'Must be a UAE mobile number, e.g. +971501234567 · يجب أن يكون رقم جوال إماراتياً، مثل ‎+971501234567';

/**
 * What someone types or pastes as a phone number, to E.164 with the UAE as the home country:
 * `050 123 4567`, `0501234567`, `971501234567`, `00971501234567`, `+971 50 123 4567` and
 * `501234567` all give `+971501234567`. Arabic-Indic digits count as digits. Anything else is
 * kept as `+` and its digits, for the validation to reject with its own message. Empty input
 * gives an empty string.
 */
export function normalisePhoneInput(input: string): string {
  const text = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const digits = text.replace(/\D/g, '');
  if (digits === '') return '';
  if (text.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('971')) return `+${digits}`;
  if (digits.startsWith('0')) return `+971${digits.slice(1)}`;
  return `+971${digits}`;
}
