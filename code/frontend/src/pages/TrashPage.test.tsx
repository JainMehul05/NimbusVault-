import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ToastProvider } from '@components/ui/Toast';
import { trashApi } from '@services/trash';
import { TrashPage } from './TrashPage';

vi.mock('@services/trash');
vi.mock('@components/layout/AppShell', () => ({
  AppShell: ({ title, description, actions, children }: Record<string, React.ReactNode>) => <main><h1>{title}</h1><p>{description}</p>{actions}{children}</main>,
}));

const item = (over: object) => ({ type: 'FILE' as const, id: 'f1', name: 'old.txt', sizeBytes: '10', deletedAt: new Date().toISOString(), ...over });
const page = (items: ReturnType<typeof item>[]) => ({ items, retentionDays: 30, pagination: { page: 1, limit: 50, total: items.length, totalPages: 1 } });
const show = () => render(<MemoryRouter><ToastProvider><TrashPage /></ToastProvider></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); });

describe('TrashPage', () => {
  it('lists files and folders with time remaining', async () => {
    vi.mocked(trashApi.list).mockResolvedValue(page([item({}), item({ type: 'FOLDER' as never, id: 'd1', name: 'Old folder', itemCount: 3 })]));
    show();
    expect(await screen.findByText('old.txt')).toBeInTheDocument();
    expect(screen.getByText(/3 files/)).toBeInTheDocument();
    expect(screen.getAllByText(/30 days left/)).toHaveLength(2);
    expect(screen.getByText(/permanently deleted after 30 days/)).toBeInTheDocument();
  });

  it('restores an item and shows why when it fails', async () => {
    vi.mocked(trashApi.list).mockResolvedValueOnce(page([item({})])).mockResolvedValueOnce(page([]));
    vi.mocked(trashApi.restore).mockRejectedValueOnce({ response: { data: { message: 'Storage quota exceeded' } } }).mockResolvedValueOnce({} as never);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Restore old.txt' }));
    expect(await screen.findByText('Storage quota exceeded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore old.txt' }));
    expect(await screen.findByText('Trash is empty')).toBeInTheDocument();
  });

  it('asks before deleting anything forever', async () => {
    vi.mocked(trashApi.list).mockResolvedValue(page([item({})]));
    vi.mocked(trashApi.purge).mockResolvedValue({} as never);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete old.txt' }));
    expect(trashApi.purge).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/can’t be undone/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(trashApi.purge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete old.txt' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete forever' }));
    await waitFor(() => expect(trashApi.purge).toHaveBeenCalledTimes(1));
  });

  it('empties the trash, and offers a retry when loading fails', async () => {
    vi.mocked(trashApi.list).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(page([item({})])).mockResolvedValue(page([]));
    vi.mocked(trashApi.empty).mockResolvedValue({} as never);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    fireEvent.click(await screen.findByRole('button', { name: /empty trash/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Empty trash' }));
    expect(await screen.findByText('Trash is empty')).toBeInTheDocument();
  });
});
