import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

/**
 * Same origin by default: in production the CDN serves the app and proxies /api, and in
 * development Vite proxies it. VITE_API_URL is only needed when the API is on another host.
 */
export const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

/**
 * Session model: the access token lives only in memory, and the refresh token only in an
 * HttpOnly cookie that script cannot read. Nothing usable by an attacker is ever in storage.
 */
let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => { accessToken = token; };
export const getAccessToken = () => accessToken;

type Listener = () => void;
const expiredListeners = new Set<Listener>();
/** Called when the session can no longer be refreshed. */
export const onSessionExpired = (fn: Listener) => {
  expiredListeners.add(fn);
  return () => { expiredListeners.delete(fn); };
};

const SESSION_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', 'X-Auth-Transport': 'cookie' };

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json', ...SESSION_HEADERS },
  withCredentials: true,
});

/** A refresh rejected by the server (as opposed to a network problem, which is not a sign-out). */
const isRejected = (err: unknown) => {
  const status = (err as AxiosError)?.response?.status;
  return status === 401 || status === 403;
};

const callRefresh = async (): Promise<string> => {
  const post = () => axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true, headers: SESSION_HEADERS });
  try {
    return (await post()).data.data.accessToken as string;
  } catch (err) {
    // Another tab rotated the cookie a moment ago; the browser now holds the new one.
    if ((err as AxiosError)?.response?.status !== 409) throw err;
    await new Promise((r) => setTimeout(r, 300));
    return (await post()).data.data.accessToken as string;
  }
};

let refreshing: Promise<string> | null = null;

/** One refresh at a time, in this tab (shared promise) and across tabs (Web Locks). */
export const refreshAccessToken = (): Promise<string> => {
  refreshing ??= (async () => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const token = locks ? await locks.request('nv:refresh', callRefresh) : await callRefresh();
    accessToken = token;
    return token;
  })().finally(() => { refreshing = null; });
  return refreshing;
};

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    // Only a request that was sent with a token can have an expired one. A 401 from signing in
    // means wrong credentials and must reach the form untouched.
    const hadToken = !!request?.headers?.Authorization;
    if (error.response?.status !== 401 || !request || request._retry || !hadToken) return Promise.reject(error);

    request._retry = true;
    try {
      await refreshAccessToken();
    } catch (refreshError) {
      if (isRejected(refreshError)) {
        accessToken = null;
        expiredListeners.forEach((fn) => fn());
      }
      return Promise.reject(error);
    }
    return api(request);
  }
);

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: string;
    details?: unknown;
  };
}

export default api;
