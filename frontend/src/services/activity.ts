import { api, type ApiResponse } from './api';

export type ActivityAction =
  | 'auth_login'
  | 'auth_failed_login'
  | 'auth_logout'
  | 'auth_password_change'
  | 'file_upload'
  | 'file_download'
  | 'file_delete'
  | 'file_restore'
  | 'file_rename'
  | 'file_move'
  | 'folder_create'
  | 'folder_delete'
  | 'share_create'
  | 'share_revoke'
  | 'share_access'
  | 'ai_query';

export type ResourceType = 'FILE' | 'FOLDER' | 'SHARE_LINK' | 'USER';

export interface ActivityLogEntry {
  id: string;
  userId: string | null;
  action: ActivityAction;
  resourceType: ResourceType | null;
  resourceId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface ActivityLogFilters {
  userId?: string;
  resourceType?: ResourceType;
  resourceId?: string;
  action?: ActivityAction;
  startDate?: string;
  endDate?: string;
  page: number;
  limit: number;
}

export interface ActivityLogResponse {
  entries: ActivityLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const activityApi = {
  getActivityLog: async (filters: ActivityLogFilters): Promise<ApiResponse<ActivityLogResponse>> => {
    const params = new URLSearchParams({
      page: filters.page.toString(),
      limit: filters.limit.toString(),
    });
    if (filters.userId) params.append('userId', filters.userId);
    if (filters.resourceType) params.append('resourceType', filters.resourceType);
    if (filters.resourceId) params.append('resourceId', filters.resourceId);
    if (filters.action) params.append('action', filters.action);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);

    const response = await api.get(`/activity?${params.toString()}`);
    return response.data;
  },

  getMyActivity: async (page = 1, limit = 20): Promise<ApiResponse<ActivityLogResponse>> => {
    const response = await api.get(`/activity/me?page=${page}&limit=${limit}`);
    return response.data;
  },

  getResourceActivity: async (
    resourceType: ResourceType,
    resourceId: string,
    page = 1,
    limit = 20
  ): Promise<ApiResponse<ActivityLogResponse>> => {
    const response = await api.get(`/activity/resource/${resourceType}/${resourceId}?page=${page}&limit=${limit}`);
    return response.data;
  },
};

export default activityApi;