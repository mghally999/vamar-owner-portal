/**
 * Whether someone is using the dashboard: the tab is visible and there was a pointer, key, wheel
 * or touch event in the last few minutes. Background work that costs database time (the token
 * refresh, the message-count poll) runs only while active, so a tab left open on an office screen
 * or behind other tabs stops waking the database (Neon bills compute by the hour it is awake).
 */
import { useSyncExternalStore } from 'react';

/** No input for this long counts as idle. */
export const IDLE_AFTER_MS = 5 * 60_000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

let lastInput = Date.now();
let active = true;
let timer: number | undefined;
const listeners = new Set<() => void>();

function visible(): boolean {
  return document.visibilityState !== 'hidden';
}

function set(next: boolean) {
  if (next === active) return;
  active = next;
  for (const l of listeners) l();
}

function scheduleIdle() {
  window.clearTimeout(timer);
  timer = window.setTimeout(
    () => {
      set(false);
    },
    Math.max(0, lastInput + IDLE_AFTER_MS - Date.now()),
  );
}

function onInput() {
  lastInput = Date.now();
  if (visible()) set(true);
  scheduleIdle();
}

function onVisibility() {
  if (visible()) {
    // Coming back to the tab is itself activity.
    onInput();
  } else {
    window.clearTimeout(timer);
    set(false);
  }
}

function start() {
  lastInput = Date.now();
  active = visible();
  for (const e of EVENTS) window.addEventListener(e, onInput, { passive: true, capture: true });
  document.addEventListener('visibilitychange', onVisibility);
  if (active) scheduleIdle();
}

function stop() {
  for (const e of EVENTS) window.removeEventListener(e, onInput, { capture: true });
  document.removeEventListener('visibilitychange', onVisibility);
  window.clearTimeout(timer);
}

/** Calls `fn` whenever the active state changes; returns the unsubscribe function. */
export function onActivityChange(fn: () => void): () => void {
  if (listeners.size === 0) start();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) stop();
  };
}

export function isActive(): boolean {
  return active;
}

/** True while the tab is visible and was used in the last IDLE_AFTER_MS. */
export function useActive(): boolean {
  return useSyncExternalStore(onActivityChange, isActive, () => true);
}
