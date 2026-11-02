/**
 * In-memory stand-ins for the native modules the app talks to. setup.ts installs them with
 * jest.mock; tests import the same objects to change what the "phone" answers and to check calls.
 * resetNative() runs before every test and puts every default back. `__esModule` keeps
 * `import * as X` pointing at these objects, so a test can change a value after the import.
 */
const resets: (() => void)[] = [];

function stub<A extends unknown[], R>(impl: (...args: A) => R): jest.Mock<R, A> {
  const fn = jest.fn(impl);
  resets.push(() => {
    fn.mockReset();
    fn.mockImplementation(impl);
  });
  return fn;
}

/** The keychain behind expo-secure-store, by native key (`vamar.lang`, `vamar.refresh`, ...). */
export const keychain = new Map<string, string>();

export const secureStore = {
  __esModule: true,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: stub((key: string) => Promise.resolve(keychain.get(key) ?? null)),
  setItemAsync: stub((key: string, value: string, _options?: unknown) => {
    keychain.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: stub((key: string) => {
    keychain.delete(key);
    return Promise.resolve();
  }),
};

export const application = {
  __esModule: true,
  nativeApplicationVersion: '1.4.0' as string | null,
  getAndroidId: stub((): string | null => 'android-id-0001'),
  getIosIdForVendorAsync: stub((): Promise<string | null> => Promise.resolve('IOS-VENDOR-0001')),
};

export const device = { __esModule: true, isDevice: true, modelName: 'Pixel 8' as string | null };

export const localAuth = {
  __esModule: true,
  hasHardwareAsync: stub(() => Promise.resolve(false)),
  isEnrolledAsync: stub(() => Promise.resolve(true)),
  authenticateAsync: stub((_options?: unknown) => Promise.resolve({ success: true })),
};

export const updates = { __esModule: true, reloadAsync: stub(() => Promise.resolve()) };

export const localization = {
  __esModule: true,
  getLocales: stub((): { languageCode: string | null }[] => [{ languageCode: 'ar' }]),
};

export const netInfo = {
  addEventListener: stub((_listener: (state: { isConnected: boolean | null }) => void) =>
    jest.fn(),
  ),
  useNetInfo: stub((): { isConnected: boolean | null } => ({ isConnected: true })),
};

export const notifications = {
  __esModule: true,
  AndroidImportance: { DEFAULT: 3 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  // Called once when push.ts loads; not reset so the handler stays inspectable.
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: stub((_id: string, _channel: unknown) => Promise.resolve(null)),
  getPermissionsAsync: stub(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: stub(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync: stub((_options?: { projectId: string }) =>
    Promise.resolve({ data: 'ExponentPushToken[device-1]' }),
  ),
};

export const constants = {
  expoConfig: { extra: { eas: { projectId: 'eas-project-1' } } } as {
    extra?: { eas?: { projectId?: string } };
  } | null,
};

/** The phone-number confirmation Firebase hands back; the right code is 123456. */
export const firebaseUser = { getIdToken: stub((_force?: boolean) => Promise.resolve('id-token')) };
export const confirmation = {
  confirm: stub((code: string) =>
    code === '123456'
      ? Promise.resolve({ user: firebaseUser })
      : Promise.reject(new Error('auth/invalid-verification-code')),
  ),
};
export const firebaseAuth = {
  __esModule: true,
  // Called once when firebase.ts loads; not reset.
  getAuth: jest.fn(() => ({ app: 'default' })),
  connectAuthEmulator: jest.fn(),
  signInWithPhoneNumber: stub((_auth: unknown, _phone: string) => Promise.resolve(confirmation)),
  signOut: stub((_auth: unknown) => Promise.resolve()),
};

export const print = {
  __esModule: true,
  printToFileAsync: stub((_options: { html: string; base64: boolean }) =>
    Promise.resolve({ uri: 'file:///tmp/print-1.pdf' }),
  ),
};
export const sharing = {
  __esModule: true,
  isAvailableAsync: stub(() => Promise.resolve(true)),
  shareAsync: stub((_uri: string, _options?: unknown) => Promise.resolve()),
};
export const fileSystem = {
  __esModule: true,
  cacheDirectory: 'file:///cache/' as string | null,
  readAsStringAsync: stub((_uri: string, _options?: unknown) => Promise.resolve('Rk9OVA==')),
  moveAsync: stub((_options: { from: string; to: string }) => Promise.resolve()),
};
export const fontAsset = {
  downloadAsync: stub(() => Promise.resolve()),
  localUri: 'file:///assets/Almarai-Regular.ttf' as string | null,
  uri: 'asset://Almarai-Regular.ttf',
};
export const asset = { fromModule: stub((_module: unknown) => fontAsset) };

export const splash = {
  __esModule: true,
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: stub(() => Promise.resolve()),
};
export const fonts = {
  __esModule: true,
  useFonts: stub((_map: unknown): [boolean, Error | null] => [true, null]),
};

export function resetNative(): void {
  keychain.clear();
  for (const reset of resets) reset();
  application.nativeApplicationVersion = '1.4.0';
  device.isDevice = true;
  device.modelName = 'Pixel 8';
  constants.expoConfig = { extra: { eas: { projectId: 'eas-project-1' } } };
  fileSystem.cacheDirectory = 'file:///cache/';
  fontAsset.localUri = 'file:///assets/Almarai-Regular.ttf';
}
