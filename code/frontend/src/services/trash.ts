import { api, type ApiResponse } from './api';

export interface TrashItem {
  type: 'FILE' | 'FOLDER';
  id: string;
  name: string;
  sizeBytes: string;
  /** Files inside a trashed folder. */
  itemCount?: number;
  mimeType?: string;
  category?: string;
  deletedAt: string;
}

export interface TrashPage {
  permanentDeletionEnabled?: boolean;
  items: TrashItem[];
  retentionDays: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const path = (item: Pick<TrashItem, 'type' | 'id'>) => `/trash/${item.type === 'FILE' ? 'files' : 'folders'}/${item.id}`;

export const trashApi = {
  list: async (page = 1, limit = 50) => (await api.get<ApiResponse<TrashPage>>(`/trash?page=${page}&limit=${limit}`)).data.data!,
  restore: (item: Pick<TrashItem, 'type' | 'id'>) => api.post(`${path(item)}/restore`),
  purge: (item: Pick<TrashItem, 'type' | 'id'>) => api.delete(path(item)),
  empty: () => api.delete('/trash'),
};
