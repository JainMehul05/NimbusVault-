import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { ToastProvider } from '@components/ui/Toast';
import { filesApi, foldersApi } from '@services/files';
import { FilesPage } from './FilesPage';

vi.mock('@services/files', async (orig) => ({
  ...(await orig<object>()),
  filesApi: { list: vi.fn(), storage: vi.fn(), upload: vi.fn(), rename: vi.fn(), move: vi.fn(), remove: vi.fn(), downloadUrl: vi.fn() },
  foldersApi: { tree: vi.fn(), contents: vi.fn(), create: vi.fn(), rename: vi.fn(), move: vi.fn(), remove: vi.fn() },
}));
vi.mock('@context/AuthContext', () => ({ useAuth: () => ({ user: { id: '1', name: 'Ada', email: 'a@b.c' }, isAuthenticated: true, logout: vi.fn() }) }));

const file = (over: object = {}) => ({ id: 'f1', filename: 'notes.txt', sizeBytes: '12', mimeType: 'text/plain', category: 'document', folderId: null, status: 'READY', aiStatus: 'INDEXED', uploadedAt: new Date().toISOString(), ...over });
const listing = (files: ReturnType<typeof file>[], total = files.length) => ({ files, pagination: { page: 1, limit: 50, total, totalPages: Math.ceil(total / 50) } });
const show = (path = '/files') =>
  render(<MemoryRouter initialEntries={[path]}><ToastProvider><Routes><Route path="/files" element={<FilesPage />} /><Route path="/files/:folderId" element={<FilesPage />} /></Routes></ToastProvider></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(foldersApi.tree).mockResolvedValue([]);
  vi.mocked(filesApi.storage).mockResolvedValue({ quota: '1000', used: '10', remaining: '990' });
});

const act = async (name: string, action: string) => {
  fireEvent.click((await screen.findAllByRole('button', { name: `Actions for ${name}` }))[0]);
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
};

describe('FilesPage', () => {
  it('shows loading, then files with AI status; then empty and error states', async () => {
    vi.mocked(filesApi.list).mockResolvedValueOnce(listing([file()]));
    const first = show();
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText('AI ready')).toBeInTheDocument();
    first.unmount();
    vi.mocked(filesApi.list).mockResolvedValueOnce(listing([]));
    const second = show();
    expect(await screen.findByText('Your vault is ready')).toBeInTheDocument();
    second.unmount();
    vi.mocked(filesApi.list).mockRejectedValueOnce({ response: { data: { message: 'Service not ready' } } });
    show();
    expect(await screen.findByText('Service not ready')).toBeInTheDocument();
  });

  it('renames and moves to trash through dialogs', async () => {
    vi.mocked(filesApi.list).mockResolvedValue(listing([file()]));
    vi.mocked(filesApi.rename).mockResolvedValue({} as never);
    vi.mocked(filesApi.remove).mockResolvedValue({} as never);
    show();
    await act('notes.txt', 'Rename');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'renamed.txt' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(filesApi.rename).toHaveBeenCalledWith('f1', 'renamed.txt'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await act('renamed.txt', 'Delete');
    expect(screen.getByRole('dialog')).toHaveTextContent(/move to trash/);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('File moved to trash')).toBeInTheDocument();
  });

  it('rejects files that are too large or exceed storage before uploading, and reports server errors', async () => {
    vi.mocked(filesApi.list).mockResolvedValue(listing([file()]));
    vi.mocked(filesApi.upload).mockRejectedValueOnce({ response: { data: { message: 'Unsupported file type' } } });
    const { container } = show();
    await screen.findByText('notes.txt');
    const big = new File(['x'], 'big.bin');
    Object.defineProperty(big, 'size', { value: 101 * 1024 * 1024 });
    const overQuota = new File(['x'.repeat(995)], 'quota.txt');
    const bad = new File(['x'], 'bad.exe');
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [big, overQuota, bad] } });
    expect(await screen.findByText('Larger than the 100 MB limit')).toBeInTheDocument();
    expect(screen.getByText('Not enough storage left')).toBeInTheDocument();
    expect(await screen.findByText('Unsupported file type')).toBeInTheDocument();
    expect(filesApi.upload).toHaveBeenCalledTimes(1);
  });

  it('pages and reports a missing folder', async () => {
    vi.mocked(filesApi.list).mockResolvedValue(listing([file()], 120));
    const first = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(filesApi.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    first.unmount();
    show('/files/unknown');
    expect(await screen.findByText('This folder isn’t available')).toBeInTheDocument();
  });
});
