import { Platform } from 'react-native';
import { deviceId, getItem, setItem } from '@/lib/storage';
import { application, keychain, secureStore } from '@/test/native';

describe('secure storage', () => {
  it('keeps values in the keychain under app-prefixed keys, readable after first unlock', async () => {
    await setItem('refreshToken', 'refresh-1');
    expect(keychain.get('vamar.refresh')).toBe('refresh-1');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith('vamar.refresh', 'refresh-1', {
      keychainAccessible: secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    expect(await getItem('refreshToken')).toBe('refresh-1');
  });

  it('deletes a key when set to null', async () => {
    keychain.set('vamar.owner', '{}');
    await setItem('owner', null);
    expect(keychain.has('vamar.owner')).toBe(false);
    expect(await getItem('owner')).toBeNull();
  });

  it('treats an unavailable keychain as empty and never throws', async () => {
    secureStore.getItemAsync.mockRejectedValue(new Error('keystore locked'));
    secureStore.setItemAsync.mockRejectedValue(new Error('keystore locked'));
    expect(await getItem('lang')).toBeNull();
    await expect(setItem('lang', 'en')).resolves.toBeUndefined();
  });
});

describe('deviceId', () => {
  it('uses the iOS vendor id once and then reuses the stored id', async () => {
    expect(await deviceId()).toBe('IOS-VENDOR-0001');
    application.getIosIdForVendorAsync.mockResolvedValue('SOMETHING-ELSE');
    expect(await deviceId()).toBe('IOS-VENDOR-0001');
    expect(keychain.get('vamar.device')).toBe('IOS-VENDOR-0001');
  });

  it('uses the Android id on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    expect(await deviceId()).toBe('android-id-0001');
  });

  it('falls back to a random 32-character hex id when the platform id is missing or short', async () => {
    application.getIosIdForVendorAsync.mockResolvedValue('abc');
    const id = await deviceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    keychain.clear();
    application.getIosIdForVendorAsync.mockRejectedValue(new Error('unavailable'));
    expect(await deviceId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
