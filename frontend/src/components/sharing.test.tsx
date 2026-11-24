import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { ToastProvider } from '@components/ui/Toast';
import { sharingApi } from '@services/sharing';
import { shareLinkApi } from '@services/shareLinks';
import { SharedByMe } from './SharedByMe';
import { ShareLinkDialog, linkStatus } from './ShareLinkDialog';

vi.mock('@services/sharing', async (orig) => ({ ...(await orig<object>()), sharingApi: { getSharedByMe: vi.fn(), listShares: vi.fn(), getSharedWithMe: vi.fn() } }));
vi.mock('@services/shareLinks');
vi.mock('@context/AuthContext', () => ({ useAuth: () => ({ user: { id: '1', name: 'Ada', email: 'ada@b.c' } }) }));

const grantee = { id: 'u2', name: 'Bob', email: 'bob@b.c' };
beforeEach(() => { vi.clearAllMocks(); });

describe('SharedByMe', () => {
  const data = { files: [{ id: 'f1', filename: 'plan.txt', shares: [{ grantee, level: 'VIEWER' as const }] }], folders: [{ id: 'd1', name: 'Team', shares: [{ grantee, level: 'EDITOR' as const }] }] };

  it('lists items with who has access and opens access management', async () => {
    vi.mocked(sharingApi.getSharedByMe).mockResolvedValue({ success: true, message: '', data });
    vi.mocked(sharingApi.listShares).mockResolvedValue({ success: true, message: '', data: { shares: [] } });
    render(<ToastProvider><SharedByMe query="" /></ToastProvider>);
    expect(await screen.findByText('plan.txt')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage access to plan.txt' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('plan.txt');
    expect(sharingApi.listShares).toHaveBeenCalledWith('FILE', 'f1');
  });

  it('filters by item or person, and covers empty and error states', async () => {
    vi.mocked(sharingApi.getSharedByMe).mockResolvedValue({ success: true, message: '', data });
    const { rerender, unmount } = render(<ToastProvider><SharedByMe query="team" /></ToastProvider>);
    expect(await screen.findByText('Team')).toBeInTheDocument();
    expect(screen.queryByText('plan.txt')).not.toBeInTheDocument();
    rerender(<ToastProvider><SharedByMe query="zzz" /></ToastProvider>);
    expect(screen.getByText('No matching items')).toBeInTheDocument();
    unmount();
    vi.mocked(sharingApi.getSharedByMe).mockRejectedValueOnce(new Error('x'));
    render(<ToastProvider><SharedByMe query="" /></ToastProvider>);
    expect(await screen.findByText('Couldn’t load items you’ve shared')).toBeInTheDocument();
  });
});

describe('ShareLinkDialog', () => {
  const file = { id: 'f1', filename: 'plan.txt' };
  const show = () => render(<ToastProvider><ShareLinkDialog open file={file} onClose={() => {}} /></ToastProvider>);

  it('creates a link with the chosen limits and shows it once', async () => {
    vi.mocked(shareLinkApi.listShareLinks).mockResolvedValue({ success: true, message: '', data: { shareLinks: [] } });
    vi.mocked(shareLinkApi.createShareLink).mockResolvedValue({ success: true, message: '', data: { url: 'https://v/share/tok' } as never });
    show();
    fireEvent.change(await screen.findByLabelText(/^Password/), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText(/^Download limit/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /create link/i }));
    expect(await screen.findByDisplayValue('https://v/share/tok')).toBeInTheDocument();
    expect(shareLinkApi.createShareLink).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f1', password: 'secret1', maxDownloads: 3, expiresAt: expect.any(String) }));
  });

  it('rejects invalid input without calling the server', async () => {
    vi.mocked(shareLinkApi.listShareLinks).mockResolvedValue({ success: true, message: '', data: { shareLinks: [] } });
    show();
    fireEvent.change(await screen.findByLabelText(/^Password/), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/^Download limit/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /create link/i }));
    expect(await screen.findByText('Use at least 4 characters.')).toBeInTheDocument();
    expect(screen.getByText(/whole number/)).toBeInTheDocument();
    expect(shareLinkApi.createShareLink).not.toHaveBeenCalled();
  });

  it('revokes only after confirmation', async () => {
    vi.mocked(shareLinkApi.listShareLinks).mockResolvedValue({ success: true, message: '', data: { shareLinks: [{ id: 'l1', permission: 'DOWNLOAD', expiresAt: null, maxDownloads: null, downloadCount: 0, revokedAt: null, createdAt: new Date().toISOString() }] } });
    vi.mocked(shareLinkApi.revokeShareLink).mockResolvedValue({ success: true, message: '', data: null });
    show();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Revoke/ }));
    expect(shareLinkApi.revokeShareLink).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(shareLinkApi.revokeShareLink).toHaveBeenCalledWith('l1'));
  });

  it('derives link status', () => {
    const base = { id: 'l', permission: 'VIEW' as const, expiresAt: null, maxDownloads: null, downloadCount: 0, revokedAt: null, createdAt: '' };
    expect(linkStatus(base).label).toBe('Active');
    expect(linkStatus({ ...base, revokedAt: 'x' }).label).toBe('Revoked');
    expect(linkStatus({ ...base, expiresAt: '2020-01-01' }).label).toBe('Expired');
    expect(linkStatus({ ...base, maxDownloads: 1, downloadCount: 1 }).label).toBe('Limit reached');
  });
});
