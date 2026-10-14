import { useState, useCallback } from 'react';
import { useAuth } from '@context/AuthContext';
import { sharingApi, type SharePermission, type ShareCreateInput, type SharedWithMeResponse, type SharedByMeResponse } from '@services/sharing';

export const useSharing = () => {
  const { isAuthenticated, user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shares, setShares] = useState<SharePermission[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMeResponse | null>(null);
  const [sharedByMe, setSharedByMe] = useState<SharedByMeResponse | null>(null);

  const createShare = useCallback(async (input: ShareCreateInput) => {
    if (!isAuthenticated || !user) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await sharingApi.createShare(input);
      if (response.success) {
        return response.data;
      } else {
        setError(response.message || 'Failed to create share');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to create share');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  const listShares = useCallback(async (resourceType: 'FILE' | 'FOLDER', resourceId: string) => {
    if (!isAuthenticated || !user) return;
    try {
      const response = await sharingApi.listShares(resourceType, resourceId);
      if (response.success && response.data) {
        setShares(response.data.shares);
        return response.data.shares;
      }
    } catch (err) {
      console.error('Failed to load shares:', err);
    }
  }, [isAuthenticated, user]);

  const updateShare = useCallback(async (
    resourceType: 'FILE' | 'FOLDER',
    resourceId: string,
    granteeId: string,
    level: 'VIEWER' | 'EDITOR'
  ) => {
    if (!isAuthenticated || !user) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await sharingApi.updateShare(resourceType, resourceId, granteeId, { level });
      if (response.success) {
        setShares(prev => prev.map(s => s.granteeUserId === granteeId ? { ...s, level } : s));
        return response.data;
      } else {
        setError(response.message || 'Failed to update share');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to update share');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  const revokeShare = useCallback(async (resourceType: 'FILE' | 'FOLDER', resourceId: string, granteeId: string) => {
    if (!isAuthenticated || !user) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await sharingApi.revokeShare(resourceType, resourceId, granteeId);
      if (response.success) {
        setShares(prev => prev.filter(s => s.granteeUserId !== granteeId));
      } else {
        setError(response.message || 'Failed to revoke share');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to revoke share');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  const fetchSharedWithMe = useCallback(async (page = 1, limit = 20) => {
    if (!isAuthenticated || !user) return;
    try {
      const response = await sharingApi.getSharedWithMe(page, limit);
      if (response.success && response.data) {
        setSharedWithMe(response.data);
        return response.data;
      }
    } catch (err) {
      console.error('Failed to load shared with me:', err);
    }
  }, [isAuthenticated, user]);

  const fetchSharedByMe = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    try {
      const response = await sharingApi.getSharedByMe();
      if (response.success && response.data) {
        setSharedByMe(response.data);
        return response.data;
      }
    } catch (err) {
      console.error('Failed to load shared by me:', err);
    }
  }, [isAuthenticated, user]);

  const clearError = useCallback(() => setError(null), []);

  return {
    isLoading,
    error,
    shares,
    sharedWithMe,
    sharedByMe,
    createShare,
    listShares,
    updateShare,
    revokeShare,
    fetchSharedWithMe,
    fetchSharedByMe,
    clearError,
  };
};