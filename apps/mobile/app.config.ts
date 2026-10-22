import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Expo app config. Brand assets come straight from packages/tokens/assets/brand.
 * API base and Firebase emulator are selected per EAS profile through EXPO_PUBLIC_* vars.
 */
const brand = '../../packages/tokens/assets/brand';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Vamar',
  slug: 'vamar-owner-portal',
  owner: 'best-coder-alive',
  scheme: 'vamar',
  version: '1.1.0',
  orientation: 'portrait',
  icon: `${brand}/app-icon-1024.png`,
  userInterfaceStyle: 'automatic',
  primaryColor: '#25323a',
  ios: {
    bundleIdentifier: 'ae.vamar.owner',
    supportsTablet: false,
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './firebase/GoogleService-Info.plist',
    infoPlist: {
      NSFaceIDUsageDescription: 'Vamar uses Face ID to unlock the app.',
      ITSAppUsesNonExemptEncryption: false,
      CFBundleAllowMixedLocalizations: true,
    },
  },
  // The owner web app served at /app (iPhone: Safari > Share > Add to Home Screen).
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: `${brand}/favicon-512.png`,
    name: 'فامار للملاك',
    shortName: 'فامار',
    lang: 'ar',
    themeColor: '#25323a',
    backgroundColor: '#ffffff',
  },
  experiments: { baseUrl: '/app' },
  android: {
    package: 'ae.vamar.owner',
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './firebase/google-services.json',
    adaptiveIcon: {
      foregroundImage: `${brand}/adaptive-icon-foreground.png`,
      monochromeImage: `${brand}/adaptive-icon-monochrome.png`,
      backgroundColor: '#162842',
    },
    permissions: [
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
      'android.permission.POST_NOTIFICATIONS',
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    ['expo-local-authentication', { faceIDPermission: 'Vamar uses Face ID to unlock the app.' }],
    ['expo-notifications', { icon: `${brand}/adaptive-icon-monochrome.png`, color: '#162842' }],
    [
      'expo-font',
      {
        fonts: [
          '../../packages/tokens/assets/fonts/Almarai-Light.ttf',
          '../../packages/tokens/assets/fonts/Almarai-Regular.ttf',
          '../../packages/tokens/assets/fonts/Almarai-Bold.ttf',
          '../../packages/tokens/assets/fonts/Almarai-ExtraBold.ttf',
        ],
      },
    ],
    [
      'expo-splash-screen',
      {
        image: `${brand}/splash-logo.png`,
        backgroundColor: '#162842',
        resizeMode: 'contain',
        imageWidth: 200,
        // Android 12+ masks the splash image inside a circle, which clips the wide wordmark;
        // the system splash gets the square mark-only asset instead.
        android: { image: `${brand}/splash-android.png`, imageWidth: 160 },
      },
    ],
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    [
      'expo-build-properties',
      {
        ios: { useFrameworks: 'static' },
        android: {
          minSdkVersion: 24,
          // Release builds strip unused code and resources (the direct-download APK was 114 MB).
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
    './plugins/withAndroidLocales.js',
  ],
  locales: {
    ar: './locales/ar.json',
    en: './locales/en.json',
  },
  extra: {
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '7e929192-4d31-4476-a3ef-49e0eeb78760' },
  },
  // EAS Update: JavaScript fixes reach installed apps of the same version (runtimeVersion) without
  // a new download. Native changes still need a new APK, announced through /api/app/version.
  updates: {
    enabled: true,
    url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID ?? '7e929192-4d31-4476-a3ef-49e0eeb78760'}`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: 'appVersion' },
});
