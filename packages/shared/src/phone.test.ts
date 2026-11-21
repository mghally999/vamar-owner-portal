import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isUaeMobile, normalisePhoneInput, phoneInCountries } from './phone.js';

describe('normalisePhoneInput', () => {
  it.each([
    ['050 123 4567', '+971501234567'],
    ['0501234567', '+971501234567'],
    ['971501234567', '+971501234567'],
    ['00971501234567', '+971501234567'],
    ['+971 50 123 4567', '+971501234567'],
    ['+971-50-123-4567', '+971501234567'],
    ['501234567', '+971501234567'],
    ['٠٥٠١٢٣٤٥٦٧', '+971501234567'],
    ['۰۵۰۱۲۳۴۵۶۷', '+971501234567'],
    ['  +966 50 123 4567 ', '+966501234567'],
    ['0044 20 7946 0958', '+442079460958'],
  ])('%s -> %s', (input, expected) => {
    expect(normalisePhoneInput(input)).toBe(expected);
  });

  it('gives an empty string for input without digits', () => {
    expect(normalisePhoneInput('')).toBe('');
    expect(normalisePhoneInput('  +  ')).toBe('');
  });

  it('turns every way of writing a UAE mobile into the same valid E.164 number (property)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^5\d{8}$/),
        fc.constantFrom('0', '971', '00971', '+971', '+971 ', ''),
        (rest, prefix) => {
          const typed = `${prefix}${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
          const phone = normalisePhoneInput(typed);
          expect(phone).toBe(`+971${rest}`);
          expect(isUaeMobile(phone)).toBe(true);
          expect(phoneInCountries(phone, ['AE'])).toBe(true);
        },
      ),
    );
  });
});

describe('isUaeMobile', () => {
  it('accepts +9715 and eight digits only', () => {
    expect(isUaeMobile('+971501234567')).toBe(true);
    expect(isUaeMobile('+97150123456')).toBe(false);
    expect(isUaeMobile('+971401234567')).toBe(false);
    expect(isUaeMobile('0501234567')).toBe(false);
  });
});
