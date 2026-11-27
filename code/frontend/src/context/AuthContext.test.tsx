import { act, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { api, onSessionExpired, refreshAccessToken, setAccessToken } from '@services/api';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('@services/api');

const Probe = () => {
  const { user, isLoading, logout } = useAuth();
  return <><p>{isLoading ? 'loading' : user ? `hello ${user.name}` : 'signed out'}</p><button onClick={logout}>out</button></>;
};
const show = () => render(<AuthProvider><Probe /></AuthProvider>);
let store: Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  store = {};
  localStorage.getItem = vi.fn((k: string) => store[k] ?? null);
  localStorage.setItem = vi.fn((k: string, v: string) => { store[k] = v; });
  localStorage.removeItem = vi.fn((k: string) => { delete store[k]; });
});

describe('AuthProvider', () => {
  it('makes no request for visitors who never signed in, and removes tokens older versions stored', async () => {
    store = { accessToken: 'a', refreshToken: 'r', tokenFamily: 'f', user: '{"name":"Mallory"}' };
    show();
    expect(screen.getByText('signed out')).toBeInTheDocument();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(store).toEqual({});
  });

  it('restores the session from the cookie and asks the server who it is', async () => {
    store = { 'nv:session': '1' };
    vi.mocked(refreshAccessToken).mockResolvedValue('t');
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: { id: '1', name: 'Ada', email: 'a@b.c' } } } as never);
    show();
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('hello Ada')).toBeInTheDocument();
    expect(JSON.stringify(store)).toBe('{"nv:session":"1"}');
  });

  it('forgets a rejected session but keeps the hint when offline', async () => {
    store = { 'nv:session': '1' };
    vi.mocked(refreshAccessToken).mockRejectedValueOnce({ response: { status: 401 } });
    const first = show();
    expect(await screen.findByText('signed out')).toBeInTheDocument();
    expect(store).toEqual({});
    first.unmount();

    store = { 'nv:session': '1' };
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(new Error('Network Error'));
    show();
    expect(await screen.findByText('signed out')).toBeInTheDocument();
    expect(store).toEqual({ 'nv:session': '1' });
  });

  it('signs out on logout, on expiry and when another tab signs out', async () => {
    const signIn = async () => {
      store = { 'nv:session': '1' };
      vi.mocked(refreshAccessToken).mockResolvedValue('t');
      vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: { id: '1', name: 'Ada', email: 'a@b.c' } } } as never);
      const view = show();
      await screen.findByText('hello Ada');
      return view;
    };
    let view = await signIn();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await act(async () => screen.getByText('out').click());
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());
    expect(setAccessToken).toHaveBeenLastCalledWith(null);
    view.unmount();

    view = await signIn();
    act(() => vi.mocked(onSessionExpired).mock.lastCall![0]());
    expect(screen.getByText('signed out')).toBeInTheDocument();
    view.unmount();

    await signIn();
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'nv:session', newValue: null })); });
    expect(screen.getByText('signed out')).toBeInTheDocument();
  });
});
