import { api, type ApiResponse } from './api';

export interface Session {
  id: string;
  device: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export const authApi = {
  sessions: async () => (await api.get<ApiResponse<{ sessions: Session[] }>>('/auth/sessions')).data.data!.sessions,
  revokeSession: (id: string) => api.delete(`/auth/sessions/${id}`),
  revokeOtherSessions: async () =>
    (await api.delete<ApiResponse<{ revoked: number }>>('/auth/sessions')).data.data!.revoked,
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};
