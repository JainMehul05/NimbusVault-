import { api, type ApiResponse } from './api';

export interface ShareLink {
  id: string;
  permission: 'VIEW' | 'DOWNLOAD';
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  revokedAt: string | null;
  createdAt: string;
}

export interface ShareLinkCreateInput {
  fileId: string;
  permission: 'VIEW' | 'DOWNLOAD';
  password?: string;
  expiresAt?: string;
  maxDownloads?: number;
}

export interface ShareLinkCreateResponse {
  id: string;
  token: string;
  permission: 'VIEW' | 'DOWNLOAD';
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  createdAt: string;
  url: string;
}

export interface ShareLinkAccessResponse {
  file: {
    id: string;
    filename: string;
    sizeBytes: string;
    mimeType: string;
    category: string;
  };
  permission: 'VIEW' | 'DOWNLOAD';
  expiresAt: string | null;
  requiresPassword: boolean;
  /** null = unlimited */
  downloadsRemaining?: number | null;
}

export interface ShareLinkDownloadResponse {
  downloadUrl: string;
  expiresIn: number;
  filename: string;
}

export const shareLinkApi = {
  createShareLink: async (input: ShareLinkCreateInput): Promise<ApiResponse<ShareLinkCreateResponse>> => {
    const response = await api.post('/share-links/protected', input);
    return response.data;
  },

  listShareLinks: async (fileId: string): Promise<ApiResponse<{ shareLinks: ShareLink[] }>> => {
    const response = await api.get(`/share-links/protected/${fileId}`);
    return response.data;
  },

  revokeShareLink: async (shareLinkId: string): Promise<ApiResponse<null>> => {
    const response = await api.delete(`/share-links/protected/${shareLinkId}`);
    return response.data;
  },

  // The password travels in a header, not the URL, so it never lands in logs or history.
  accessShareLink: async (token: string, password?: string): Promise<ApiResponse<ShareLinkAccessResponse>> => {
    const response = await api.get(`/share-links/public/${encodeURIComponent(token)}`, {
      headers: password ? { 'X-Share-Password': password } : undefined,
    });
    return response.data;
  },

  downloadShareLink: async (token: string, password?: string): Promise<ApiResponse<ShareLinkDownloadResponse>> => {
    const response = await api.get(`/share-links/public/${encodeURIComponent(token)}/download`, {
      headers: password ? { 'X-Share-Password': password } : undefined,
    });
    return response.data;
  },
};

export default shareLinkApi;