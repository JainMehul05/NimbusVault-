import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, onSessionExpired, refreshAccessToken, setAccessToken } from '@services/api';
import type { ApiResponse } from '@services/api';

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, inviteCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

type AuthResponse = ApiResponse<{ user: User; tokens: { accessToken: string } }>;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Not a credential: only remembers that this browser probably has a session cookie, so people
 * who never signed in do not trigger a refresh request on every page load.
 */
const HINT_KEY = 'nv:session';
const LEGACY_KEYS = ['accessToken', 'refreshToken', 'tokenFamily', 'user'];

const storage = {
  hasHint: () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } },
  setHint: (on: boolean) => {
    try {
      if (on) localStorage.setItem(HINT_KEY, '1');
      else localStorage.removeItem(HINT_KEY);
    } catch { /* storage unavailable: the session simply is not restored on reload */ }
  },
  /** Earlier versions kept tokens here, where any script could read them. */
  clearLegacy: () => { try { LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } },
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(() => storage.hasHint());

  const clear = useCallback(() => {
    setAccessToken(null);
    storage.setHint(false);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const response = await api.get<ApiResponse<User>>('/auth/me');
    if (response.data.data) setUser(response.data.data);
  }, []);

  // Restore the session from the HttpOnly cookie. The server, not local storage, decides who this is.
  useEffect(() => {
    storage.clearLegacy();
    if (!storage.hasHint()) return;
    let active = true;
    (async () => {
      try {
        await refreshAccessToken();
        await refreshUser();
      } catch (err) {
        // Keep the hint on network errors so a reload can try again.
        if (active && (err as { response?: unknown })?.response) clear();
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [clear, refreshUser]);

  useEffect(() => onSessionExpired?.(clear), [clear]);

  // Signing out in one tab signs out the others.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === HINT_KEY && e.newValue === null) clear(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [clear]);

  const open = (response: { data: AuthResponse }) => {
    const data = response.data.data;
    if (!response.data.success || !data) return;
    setAccessToken(data.tokens.accessToken);
    storage.setHint(true);
    setUser(data.user);
  };

  const login = async (email: string, password: string) => open(await api.post<AuthResponse>('/auth/login', { email, password }));

  const register = async (name: string, email: string, password: string, inviteCode?: string) =>
    open(await api.post<AuthResponse>('/auth/register', { name, email, password, ...(inviteCode ? { inviteCode } : {}) }));

  const logout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // The local session ends regardless; the server-side one expires on its own.
    }
    clear();
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
