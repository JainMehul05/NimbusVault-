import { api, type ApiResponse } from './api';

export interface FileRecord {
  id: string;
  filename: string;
  sizeBytes: string;
  mimeType: string;
  category: string;
  folderId: string | null;
  status: string;
  /** AI indexing state: NA | PENDING | PROCESSING | INDEXED | FAILED | UNSUPPORTED */
  aiStatus?: string;
  uploadedAt: string;
}

export interface FolderContents {
  folder: { id: string; name: string; parentFolderId: string | null; ownerId: string } | null;
  permission: 'OWNER' | 'EDITOR' | 'VIEWER';
  /** Breadcrumb from the highest folder the caller can access down to this one. */
  path: Array<{ id: string; name: string }>;
  folders: Array<{ id: string; name: string; parentFolderId: string | null; createdAt: string; updatedAt: string }>;
  files: FileRecord[];
}

export interface FolderNode {
  id: string;
  name: string;
  parentFolderId: string | null;
  depth: number;
  createdAt: string;
  updatedAt: string;
  children: FolderNode[];
}

export interface StorageInfo {
  quota: string;
  used: string;
  remaining: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type FileSortField = 'filename' | 'sizeBytes' | 'uploadedAt' | 'category';

export interface FileListParams {
  /** null = root only; undefined = every folder. */
  folderId?: string | null;
  search?: string;
  category?: string;
  page?: number;
  limit?: number;
  sortBy?: FileSortField;
  sortOrder?: 'asc' | 'desc';
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const filesApi = {
  list: async (p: FileListParams) => {
    const params = new URLSearchParams({
      page: String(p.page ?? 1),
      limit: String(p.limit ?? 50),
      sortBy: p.sortBy ?? 'uploadedAt',
      sortOrder: p.sortOrder ?? 'desc',
    });
    if (p.folderId === null) params.append('folderId', 'root');
    else if (p.folderId) params.append('folderId', p.folderId);
    if (p.search) params.append('search', p.search);
    if (p.category) params.append('category', p.category);
    const res = await api.get<ApiResponse<{ files: FileRecord[]; pagination: Pagination }>>(`/files?${params}`);
    return res.data.data!;
  },
  storage: async () => (await api.get<ApiResponse<StorageInfo>>('/files/storage/info')).data.data!,
  upload: async (file: File, folderId: string | null, onProgress: (pct: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    if (folderId) form.append('folderId', folderId);
    const res = await api.post<ApiResponse<FileRecord>>('/files', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => { if (e.total) onProgress(Math.round((e.loaded * 100) / e.total)); },
    });
    return res.data.data!;
  },
  downloadUrl: async (fileId: string) =>
    (await api.get<ApiResponse<{ downloadUrl: string; filename: string }>>(`/files/${fileId}/download`)).data.data!,
  rename: (fileId: string, filename: string) => api.patch(`/files/${fileId}/rename`, { filename }),
  move: (fileId: string, folderId: string | null) => api.patch(`/files/${fileId}/move`, { folderId }),
  remove: (fileId: string) => api.delete(`/files/${fileId}`),
};

export const foldersApi = {
  tree: async () => (await api.get<ApiResponse<{ tree: FolderNode[] }>>('/folders/tree')).data.data?.tree ?? [],
  /** Contents of any folder the caller can read (own or shared, including inherited access). */
  contents: async (folderId: string) =>
    (await api.get<ApiResponse<FolderContents>>(`/folders/${folderId}/contents`)).data.data!,
  create: (name: string, parentFolderId: string | null) => api.post('/folders', { name, parentFolderId }),
  rename: (folderId: string, name: string) => api.patch(`/folders/${folderId}/rename`, { name }),
  move: (folderId: string, parentFolderId: string | null) => api.patch(`/folders/${folderId}/move`, { parentFolderId }),
  /** Soft-deletes the folder together with every subfolder and file inside it. */
  remove: (folderId: string) => api.delete(`/folders/${folderId}?deleteDescendants=true`),
};

/**
 * Starts a download. The URL is always served as an attachment, so navigating a hidden link
 * saves the file without leaving the page (and, unlike window.open, is never popup-blocked).
 */
export const startDownload = (url: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const openDownload = async (fileId: string) => startDownload((await filesApi.downloadUrl(fileId)).downloadUrl);

// ---- Folder tree helpers --------------------------------------------------

export const flattenTree = (nodes: FolderNode[], out: FolderNode[] = []): FolderNode[] => {
  for (const n of nodes) {
    out.push(n);
    flattenTree(n.children ?? [], out);
  }
  return out;
};

/** Root → … → folder. Empty for root or an unknown id. */
export const pathTo = (nodes: FolderNode[], id: string | null): FolderNode[] => {
  if (!id) return [];
  for (const n of nodes) {
    if (n.id === id) return [n];
    const sub = pathTo(n.children ?? [], id);
    if (sub.length) return [n, ...sub];
  }
  return [];
};

export const findNode = (nodes: FolderNode[], id: string | null): FolderNode | null =>
  id ? flattenTree(nodes).find((n) => n.id === id) ?? null : null;

/** Ids of a folder and all its descendants (invalid move targets for that folder). */
export const subtreeIds = (node: FolderNode): Set<string> => new Set(flattenTree([node]).map((n) => n.id));
