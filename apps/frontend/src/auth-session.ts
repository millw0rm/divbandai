export const AUTH_TOKEN_COOKIE = 'divband_token';
export const AUTH_TOKEN_STORAGE_KEY = 'divband.dashboard.token';
export const AUTH_USER_STORAGE_KEY = 'divband.dashboard.user';
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export function getAuthToken(): string | undefined {
  if (typeof document !== 'undefined') {
    const cookieToken = readCookie(AUTH_TOKEN_COOKIE);
    if (cookieToken) {
      return cookieToken;
    }
  }

  return safeLocalStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? undefined;
}

export function setAuthToken(token: string): void {
  safeLocalStorage()?.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  if (typeof document !== 'undefined') {
    document.cookie = `${AUTH_TOKEN_COOKIE}=${token}; path=/; max-age=${TOKEN_MAX_AGE_SECONDS}; samesite=lax`;
  }
}

export function setAuthSession(token: string, user?: unknown): void {
  setAuthToken(token);
  if (user) {
    safeLocalStorage()?.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  }
}

export function getStoredAuthUser<T>(): T | undefined {
  const raw = safeLocalStorage()?.getItem(AUTH_USER_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function clearAuthToken(): void {
  safeLocalStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY);
  safeLocalStorage()?.removeItem(AUTH_USER_STORAGE_KEY);
  if (typeof document !== 'undefined') {
    document.cookie = `${AUTH_TOKEN_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }
}

export function hasAuthToken(): boolean {
  return Boolean(getAuthToken());
}

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));
  if (!match) {
    return undefined;
  }
  return match.slice(prefix.length);
}

function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
