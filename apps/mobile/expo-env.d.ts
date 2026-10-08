/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_BASE?: string;
    EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?: string;
  }
}

// Expo's runtime ships WebCrypto globals (getRandomValues, randomUUID); React Native's types do not declare them.
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): string;
};
