/**
 * localStorage access that never throws (private browsing, quota, disabled storage, SSR/jsdom quirks)
 * plus a tiny persisted external store that works with React's useSyncExternalStore.
 */

export function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function safeKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k !== null) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}

export interface Store<T> {
  /** Stable snapshot: the same object until the value changes. */
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
  /** Re-read from storage (used by tests and by the cross-tab `storage` event). */
  reload: () => void;
}

/**
 * A persisted store. `parse` receives whatever JSON was stored (or undefined) and must always return a
 * valid value, so corrupt or outdated data degrades to defaults instead of crashing the app.
 * The in-memory value keeps working even when writing to storage fails.
 */
export function createStore<T>(key: string, parse: (raw: unknown) => T): Store<T> {
  const listeners = new Set<() => void>();

  const load = (): T => {
    const raw = safeGet(key);
    if (raw === null) return parse(undefined);
    try {
      return parse(JSON.parse(raw) as unknown);
    } catch {
      return parse(undefined);
    }
  };

  let current = load();
  const emit = () => listeners.forEach((l) => l());

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (e) => {
      if (e.key === key || e.key === null) {
        current = load();
        emit();
      }
    });
  }

  return {
    get: () => current,
    set(next) {
      current = typeof next === 'function' ? (next as (prev: T) => T)(current) : next;
      safeSet(key, JSON.stringify(current));
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload() {
      current = load();
      emit();
    },
  };
}
