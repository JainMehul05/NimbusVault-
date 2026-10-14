import { api, type ApiResponse } from './api';

export interface SharePermission {
  id: string;
  resourceType: 'FILE' | 'FOLDER';
  resourceId: string;
  granteeUserId: string;
  level: 'VIEWER' | 'EDITOR';
  grantedBy: string;
  createdAt: string;
  grantee: {
    id: string;
    name: string;
    email: string;
  };
}

export interface ShareCreateInput {
  resourceType: 'FILE' | 'FOLDER';
  resourceId: string;
  granteeEmail: string;
  level: 'VIEWER' | 'EDITOR';
}

export interface ShareUpdateInput {
  level: 'VIEWER' | 'EDITOR';
}

export interface SharedWithMeFile {
  id: string;
  filename: string;
  sizeBytes: string;
  mimeType: string;
  category: string;
  folderId: string | null;
  permission: 'VIEWER' | 'EDITOR';
  owner: {
    id: string;
    name: string;
    email: string;
  };
}

export interface SharedWithMeFolder {
  id: string;
  name: string;
  permission: 'VIEWER' | 'EDITOR';
  owner: {
    id: string;
    name: string;
    email: string;
  };
}

export interface SharedWithMeResponse {
  files: SharedWithMeFile[];
  folders: SharedWithMeFolder[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SharedByMeFile {
  id: string;
  filename: string;
  shares: Array<{
    grantee: { id: string; name: string; email: string };
    level: 'VIEWER' | 'EDITOR';
  }>;
}

export interface SharedByMeFolder {
  id: string;
  name: string;
  shares: Array<{
    grantee: { id: string; name: string; email: string };
    level: 'VIEWER' | 'EDITOR';
  }>;
}

export interface SharedByMeResponse {
  files: SharedByMeFile[];
  folders: SharedByMeFolder[];
}

export const sharingApi = {
  createShare: async (input: ShareCreateInput): Promise<ApiResponse<{ permission: SharePermission; grantee: { id: string; name: string; email: string } }>> => {
    const response = await api.post('/sharing', input);
    return response.data;
  },

  listShares: async (resourceType: 'FILE' | 'FOLDER', resourceId: string): Promise<ApiResponse<{ shares: SharePermission[] }>> => {
    const response = await api.get(`/sharing/${resourceType}/${resourceId}`);
    return response.data;
  },

  updateShare: async (
    resourceType: 'FILE' | 'FOLDER',
    resourceId: string,
    granteeId: string,
    input: ShareUpdateInput
  ): Promise<ApiResponse<SharePermission>> => {
    const response = await api.patch(`/sharing/${resourceType}/${resourceId}/${granteeId}`, input);
    return response.data;
  },

  revokeShare: async (resourceType: 'FILE' | 'FOLDER', resourceId: string, granteeId: string): Promise<ApiResponse<null>> => {
    const response = await api.delete(`/sharing/${resourceType}/${resourceId}/${granteeId}`);
    return response.data;
  },

  getSharedWithMe: async (page = 1, limit = 20): Promise<ApiResponse<SharedWithMeResponse>> => {
    const response = await api.get(`/sharing/me/shared-with-me?page=${page}&limit=${limit}`);
    return response.data;
  },

  getSharedByMe: async (): Promise<ApiResponse<SharedByMeResponse>> => {
    const response = await api.get('/sharing/me/shared-by-me');
    return response.data;
  },
};

export default sharingApi;