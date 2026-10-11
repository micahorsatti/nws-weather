// @vitest-environment jsdom
/**
 * A reload (or a restored tab) while a dialog was open leaves the page on that dialog's history entry, with
 * nothing open. The app must step off it at startup so one Back leaves the app. This needs a fresh module, so it
 * is separate from backToClose.test.tsx, which shares one module instance across its tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  window.history.replaceState(null, '');
});

describe('Back handling at startup', () => {
  it('steps off a stale dialog entry as soon as the module loads, before any dialog is opened', async () => {
    window.history.replaceState({ nwsDialog: true }, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      setTimeout(() => window.dispatchEvent(new PopStateEvent('popstate', { state: null })), 0);
    });
    vi.resetModules();
    await import('./useModal');
    expect(back).toHaveBeenCalledTimes(1);

    // The pop that step causes is ours: nothing else may react to it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('leaves history alone on an ordinary start', async () => {
    window.history.replaceState(null, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    vi.resetModules();
    await import('./useModal');
    expect(back).not.toHaveBeenCalled();

    window.history.replaceState({ something: 'else' }, '');
    vi.resetModules();
    await import('./useModal');
    expect(back).not.toHaveBeenCalled();
  });
});
