import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ToastProvider } from '@components/ui/Toast';
import { authApi } from '@services/auth';
import { AccountPage } from './AccountPage';

vi.mock('@services/auth');
vi.mock('@context/AuthContext', () => ({ useAuth: () => ({ user: { id: '1', name: 'Ada', email: 'ada@b.c' } }) }));
vi.mock('@components/layout/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const now = new Date().toISOString();
const sessions = [
  { id: 's1', device: UA, ipAddress: '1.2.3.4', createdAt: now, lastUsedAt: now, current: true },
  { id: 's2', device: 'curl/8', ipAddress: null, createdAt: now, lastUsedAt: now, current: false },
];
const show = () => render(<MemoryRouter><ToastProvider><AccountPage /></ToastProvider></MemoryRouter>);
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.sessions).mockResolvedValue(sessions);
});

describe('AccountPage', () => {
  it('lists devices and only lets others be signed out', async () => {
    vi.mocked(authApi.revokeSession).mockResolvedValue({} as never);
    show();
    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out API client' }));
    await waitFor(() => expect(authApi.revokeSession).toHaveBeenCalledWith('s2'));
    expect(screen.queryByRole('button', { name: 'Sign out Chrome on Windows' })).not.toBeInTheDocument();
  });

  it('validates a new password before calling the server', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Enter your current password.')).toBeInTheDocument();
    fill('Current password', 'Old12345');
    fill('New password', 'onlyletters');
    fill('Confirm new password', 'different1');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/letter and one number or symbol/)).toBeInTheDocument();
    expect(screen.getByText('Passwords don’t match.')).toBeInTheDocument();
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it('changes the password and reports server errors', async () => {
    vi.mocked(authApi.changePassword).mockRejectedValueOnce({ response: { data: { message: 'Current password is incorrect' } } }).mockResolvedValueOnce({} as never);
    show();
    fill('Current password', 'Old12345');
    fill('New password', 'Brandnew9');
    fill('Confirm new password', 'Brandnew9');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('shows a retry when devices cannot be loaded', async () => {
    vi.mocked(authApi.sessions).mockRejectedValueOnce(new Error('x'));
    show();
    expect(await screen.findByText('Couldn’t load devices')).toBeInTheDocument();
  });
});
