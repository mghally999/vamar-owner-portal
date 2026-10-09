import { describe, expect, it } from 'vitest';
import { messages, type MessageKey } from './messages';

const keys = Object.keys(messages.en) as MessageKey[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dashboard messages', () => {
  it('has the same keys in Arabic and English with no empty strings', () => {
    expect(Object.keys(messages.ar).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(messages.ar[k].trim(), `ar.${k}`).not.toBe('');
      expect(messages.en[k].trim(), `en.${k}`).not.toBe('');
    }
  });

  it('uses the same placeholders in both languages', () => {
    for (const k of keys) {
      expect(placeholders(messages.ar[k]), k).toEqual(placeholders(messages.en[k]));
    }
  });

  it('contains no emoji or Eastern Arabic digits (Western digits everywhere)', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const easternDigits = /[٠-٩۰-۹]/;
    for (const k of keys) {
      for (const lang of ['ar', 'en'] as const) {
        expect(messages[lang][k], `${lang}.${k}`).not.toMatch(emoji);
        expect(messages[lang][k], `${lang}.${k}`).not.toMatch(easternDigits);
      }
    }
  });
});
