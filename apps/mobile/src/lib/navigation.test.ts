import { describe, expect, it, vi } from 'vitest';
import { goBackOr } from './navigation';

function fakeRouter(canGoBack: boolean) {
  return { canGoBack: () => canGoBack, back: vi.fn(), replace: vi.fn() };
}

describe('goBackOr', () => {
  it('goes back when there is a screen behind', () => {
    const router = fakeRouter(true);
    goBackOr(router, '/(auth)');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('opens the fallback when the screen was opened on its own', () => {
    const router = fakeRouter(false);
    goBackOr(router, '/(auth)');
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(auth)');
  });
});
