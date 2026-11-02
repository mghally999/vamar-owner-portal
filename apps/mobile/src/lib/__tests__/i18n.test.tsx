import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { I18nManager, Platform, Text } from 'react-native';
import { LangProvider, useI18n } from '@/lib/i18n';
import { getItem, setItem } from '@/lib/storage';
import { localization, updates } from '@/test/native';

type I18n = ReturnType<typeof useI18n>;
let i18n: I18n | undefined;

function Probe() {
  i18n = useI18n();
  return <Text>{`${i18n.lang} ready:${String(i18n.ready)} rtl:${String(i18n.isRTL)}`}</Text>;
}

function current(): I18n {
  if (!i18n) throw new Error('not rendered');
  return i18n;
}

async function start() {
  await render(
    <LangProvider>
      <Probe />
    </LangProvider>,
  );
}

let forceRTL: jest.SpyInstance;
beforeEach(() => {
  i18n = undefined;
  forceRTL = jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);
  jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
});

describe('LangProvider start-up', () => {
  it('uses the saved language; English in a left-to-right app starts without a reload', async () => {
    await setItem('lang', 'en');
    await start();
    expect(await screen.findByText('en ready:true rtl:false')).toBeTruthy();
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('follows the phone language when nothing is saved', async () => {
    localization.getLocales.mockReturnValue([{ languageCode: 'en' }]);
    await start();
    expect(await screen.findByText('en ready:true rtl:false')).toBeTruthy();
  });

  it('defaults to Arabic and reloads once to switch the layout to right to left', async () => {
    localization.getLocales.mockReturnValue([]);
    await start();
    await waitFor(() => {
      expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
    });
    expect(forceRTL).toHaveBeenCalledWith(true);
    // The app restarts; this instance never reports ready.
    expect(screen.getByText('ar ready:false rtl:true')).toBeTruthy();
  });

  it('carries on in the current direction when a reload is not possible', async () => {
    updates.reloadAsync.mockRejectedValue(new Error('not available in a dev client'));
    await start();
    expect(await screen.findByText('ar ready:true rtl:true')).toBeTruthy();
  });

  it('does not reload when the layout is already right to left', async () => {
    jest.replaceProperty(I18nManager, 'isRTL', true);
    await setItem('lang', 'ar');
    await start();
    expect(await screen.findByText('ar ready:true rtl:true')).toBeTruthy();
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('on the web sets the page direction instead of reloading', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const documentElement = { dir: '', lang: '' };
    Object.assign(globalThis, { document: { documentElement } });
    try {
      await setItem('lang', 'ar');
      await start();
      expect(await screen.findByText('ar ready:true rtl:true')).toBeTruthy();
      expect(documentElement).toEqual({ dir: 'rtl', lang: 'ar' });
      await act(() => current().switchLang('en'));
      expect(documentElement).toEqual({ dir: 'ltr', lang: 'en' });
      expect(screen.getByText('en ready:true rtl:false')).toBeTruthy();
      expect(updates.reloadAsync).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('on the web without a document (server render) still starts', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    await setItem('lang', 'en');
    await start();
    expect(await screen.findByText('en ready:true rtl:false')).toBeTruthy();
  });
});

describe('switching language', () => {
  it('saves the choice, flips the direction and reloads the app', async () => {
    await setItem('lang', 'en');
    await start();
    await screen.findByText('en ready:true rtl:false');
    await act(() => current().switchLang('ar'));
    expect(await getItem('lang')).toBe('ar');
    expect(forceRTL).toHaveBeenLastCalledWith(true);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByText('ar ready:true rtl:true')).toBeTruthy();
  });

  it('applies on the next launch when the reload is unavailable', async () => {
    await setItem('lang', 'en');
    await start();
    await screen.findByText('en ready:true rtl:false');
    updates.reloadAsync.mockRejectedValue(new Error('no reload'));
    await act(() => current().switchLang('ar'));
    expect(screen.getByText('ar ready:true rtl:true')).toBeTruthy();
  });
});

describe('formatting', () => {
  it('translates with variables and formats money, numbers, dates and months', async () => {
    await setItem('lang', 'en');
    await start();
    await screen.findByText('en ready:true rtl:false');
    const en = current();
    expect(en.t('home_occupancy', { occupied: 3, total: 4 })).toBe('3 of 4 units rented');
    expect(en.t('settings')).toBe('Settings');
    expect(en.money(1_250_050)).toBe('AED 12,500.50');
    expect(en.money(null)).toBe('—');
    expect(en.money(undefined)).toBe('—');
    expect(en.num(500_000)).toBe('5,000');
    expect(en.date('2026-10-05')).toBe('5 Oct 2026');
    expect(en.date(null)).toBe('—');
    expect(en.month('2026-10-01')).toBe('October 2026');
    expect(en.pick('برج', 'Tower')).toBe('Tower');
  });

  it('uses Arabic words in Arabic', async () => {
    jest.replaceProperty(I18nManager, 'isRTL', true);
    await setItem('lang', 'ar');
    await start();
    await screen.findByText('ar ready:true rtl:true');
    const ar = current();
    expect(ar.money(1_250_000)).toBe('12,500 درهم');
    expect(ar.pick('برج', 'Tower')).toBe('برج');
    expect(ar.t('settings')).toBe('الإعدادات');
  });

  it('refuses to be used outside the provider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useI18n())).rejects.toThrow('useI18n outside LangProvider');
  });
});
