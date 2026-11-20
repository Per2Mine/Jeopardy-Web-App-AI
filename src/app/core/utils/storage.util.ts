const memoryLocal = new Map<string, string>();
const memorySession = new Map<string, string>();

export function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryLocal.get(key) ?? null;
  }
}

export function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryLocal.set(key, value);
  }
}

export function safeLocalStorageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    memoryLocal.delete(key);
  }
}

export function safeSessionStorageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return memorySession.get(key) ?? null;
  }
}

export function safeSessionStorageSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    memorySession.set(key, value);
  }
}

export function safeSessionStorageRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    memorySession.delete(key);
  }
}
