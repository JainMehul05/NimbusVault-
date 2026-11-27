import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '@context/AuthContext';
import { SharedFolderPage } from '@pages/SharedFolderPage';
import { api } from '@services/api';

vi.mock('@services/api');

const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes><Route path="/shared-with-me/folders/:folderId" element={<SharedFolderPage />} /></Routes>
      </AuthProvider>
    </MemoryRouter>
  );

describe('SharedFolderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.getItem = vi.fn().mockReturnValue(null);
  });

  it('browses a nested shared folder with breadcrumbs, role and AI status', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/folders/f-child/contents') {
        return ok({
          folder: { id: 'f-child', name: 'Specs', parentFolderId: 'f-top', ownerId: 'o' },
          permission: 'VIEWER',
          path: [{ id: 'f-top', name: 'Team' }, { id: 'f-child', name: 'Specs' }],
          folders: [{ id: 'f-deep', name: 'Drafts', parentFolderId: 'f-child', createdAt: '', updatedAt: '' }],
          files: [{ id: 'x', filename: 'spec.pdf', sizeBytes: '2048', mimeType: 'application/pdf', category: 'pdf', folderId: 'f-child', status: 'READY', aiStatus: 'INDEXED', uploadedAt: new Date().toISOString() }],
        }) as never;
      }
      return ok({ quota: '1', used: '0', remaining: '1' }) as never;
    });
    renderAt('/shared-with-me/folders/f-child');

    expect(await screen.findByText('spec.pdf')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/shared-with-me/folders/f-top');
    expect(screen.getByRole('link', { name: /Drafts/ })).toHaveAttribute('href', '/shared-with-me/folders/f-deep');
    expect(screen.getByText('Viewer')).toBeInTheDocument();
    expect(screen.getByText('AI ready')).toBeInTheDocument();
  });

  it('shows an unavailable state when access was revoked', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.endsWith('/contents')
        ? (Promise.reject({ response: { status: 404, data: { message: 'Folder not found' } } }) as never)
        : (ok({ quota: '1', used: '0', remaining: '1' }) as never)
    );
    renderAt('/shared-with-me/folders/gone');
    expect(await screen.findByText(/isn’t available/i)).toBeInTheDocument();
  });
});
