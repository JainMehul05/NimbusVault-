import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { vi } from 'vitest';
import { api, getAccessToken, onSessionExpired, refreshAccessToken, setAccessToken } from './api';

const reply = (config: InternalAxiosRequestConfig, status: number, data: unknown = {}) => {
  const response = { data, status, statusText: '', headers: {}, config };
  return status < 400 ? Promise.resolve(response) : Promise.reject(new axios.AxiosError('x', undefined, config, null, response));
};

describe('session handling', () => {
  let adapter: ReturnType<typeof vi.fn<AxiosAdapter>>;
  let refresh: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    adapter = vi.fn<AxiosAdapter>();
    api.defaults.adapter = adapter;
    refresh = vi.spyOn(axios, 'post');
    setAccessToken('old');
  });
  afterEach(() => { vi.restoreAllMocks(); setAccessToken(null); });

  const refreshed = (token = 'new') => ({ data: { data: { accessToken: token } } });
  const rejected = (status: number) => Object.assign(new Error('rejected'), { response: { status } });

  it('refreshes once for several simultaneous 401s and replays each request', async () => {
    adapter.mockImplementation((c) => reply(c, c.headers.Authorization === 'Bearer old' ? 401 : 200, { ok: c.url }));
    refresh.mockResolvedValue(refreshed());
    const results = await Promise.all(['/a', '/b', '/c'].map((u) => api.get(u)));
    expect(results.map((r) => r.data.ok)).toEqual(['/a', '/b', '/c']);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('new');
  });

  it('sends no token in the refresh body, only the CSRF headers and cookie', async () => {
    refresh.mockResolvedValue(refreshed());
    await refreshAccessToken();
    const [url, body, config] = refresh.mock.calls[0] as [string, unknown, { withCredentials: boolean; headers: object }];
    expect(url).toMatch(/\/auth\/refresh$/);
    expect(body).toEqual({});
    expect(config).toMatchObject({ withCredentials: true, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  });

  it('ends the session when the server rejects the refresh', async () => {
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    adapter.mockImplementation((c) => reply(c, 401));
    refresh.mockRejectedValue(rejected(401));
    await expect(api.get('/a')).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    off();
  });

  it('keeps the session through a network failure or server error during refresh', async () => {
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    adapter.mockImplementation((c) => reply(c, 401));
    refresh.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(rejected(503));
    await expect(api.get('/a')).rejects.toBeDefined();
    await expect(api.get('/a')).rejects.toBeDefined();
    expect(expired).not.toHaveBeenCalled();
    off();
  });

  it('retries when another tab refreshed first', async () => {
    refresh.mockRejectedValueOnce(rejected(409)).mockResolvedValueOnce(refreshed('second'));
    expect(await refreshAccessToken()).toBe('second');
  });

  it('passes a failed sign-in straight to the form', async () => {
    setAccessToken(null);
    adapter.mockImplementation((c) => reply(c, 401, { message: 'Invalid credentials' }));
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ response: { status: 401 } });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not loop when the replayed request is rejected again', async () => {
    adapter.mockImplementation((c) => reply(c, 401));
    refresh.mockResolvedValue(refreshed());
    await expect(api.get('/a')).rejects.toBeDefined();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
