/**
 * Runs before every Jest test file: native modules, the router and the network are replaced by
 * the stand-ins in this folder, and reset before each test. A test file may still jest.mock a
 * module itself; its own mock wins.
 */
import type * as ReactNative from 'react-native';
import { fetchMock, resetApi } from './api';
import type * as FlashList from './flash-list';
import { resetNative } from './native';
import type * as NativeModule from './native';
import { resetRouter } from './router';
import type * as Router from './router';

type Native = typeof NativeModule;

jest.mock('expo-secure-store', () => (require('./native') as Native).secureStore);
jest.mock('expo-application', () => (require('./native') as Native).application);
jest.mock('expo-device', () => (require('./native') as Native).device);
jest.mock('expo-local-authentication', () => (require('./native') as Native).localAuth);
jest.mock('expo-updates', () => (require('./native') as Native).updates);
jest.mock('expo-localization', () => (require('./native') as Native).localization);
jest.mock('expo-notifications', () => (require('./native') as Native).notifications);
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: (require('./native') as Native).constants,
}));
jest.mock('@react-native-community/netinfo', () => {
  const { netInfo } = require('./native') as Native;
  return { __esModule: true, default: netInfo, useNetInfo: netInfo.useNetInfo };
});
jest.mock('@react-native-firebase/app', () => ({ getApp: () => ({ name: '[DEFAULT]' }) }));
jest.mock('@react-native-firebase/auth', () => (require('./native') as Native).firebaseAuth);
jest.mock('expo-print', () => (require('./native') as Native).print);
jest.mock('expo-sharing', () => (require('./native') as Native).sharing);
jest.mock('expo-file-system/legacy', () => (require('./native') as Native).fileSystem);
jest.mock('expo-asset', () => ({ Asset: (require('./native') as Native).asset }));
jest.mock('expo-splash-screen', () => (require('./native') as Native).splash);
jest.mock('expo-font', () => (require('./native') as Native).fonts);
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native') as typeof ReactNative;
  return { GestureHandlerRootView: View };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => (require('./router') as typeof Router).expoRouterMock);
jest.mock('@shopify/flash-list', () => require('./flash-list') as typeof FlashList);

globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  resetNative();
  resetApi();
  resetRouter();
  // Undoes jest.spyOn and jest.replaceProperty (Platform.OS, I18nManager.isRTL, ...).
  jest.restoreAllMocks();
});
