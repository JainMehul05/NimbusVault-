import { useState, useCallback } from 'react';
import { useAuth } from '@context/AuthContext';
import { shareLinkApi, type ShareLink, type ShareLinkCreateInput, type ShareLinkCreateResponse } from '@services/shareLinks';

export const useShareLinks = () => {
  const { isAuthenticated, user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);

  const createShareLink = useCallback(async (input: ShareLinkCreateInput): Promise<ShareLinkCreateResponse | null> => {
    if (!isAuthenticated || !user) return null;
    setIsLoading(true);
    setError(null);
    try {
      const response = await shareLinkApi.createShareLink(input);
      if (response.success && response.data) {
        return response.data;
      } else {
        setError(response.message || 'Failed to create share link');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to create share link');
    } finally {
      setIsLoading(false);
    }
    return null;
  }, [isAuthenticated, user]);

  const listShareLinks = useCallback(async (fileId: string) => {
    if (!isAuthenticated || !user) return;
    try {
      const response = await shareLinkApi.listShareLinks(fileId);
      if (response.success && response.data) {
        setShareLinks(response.data.shareLinks);
        return response.data.shareLinks;
      }
    } catch (err) {
      console.error('Failed to load share links:', err);
    }
  }, [isAuthenticated, user]);

  const revokeShareLink = useCallback(async (shareLinkId: string) => {
    if (!isAuthenticated || !user) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await shareLinkApi.revokeShareLink(shareLinkId);
      if (response.success) {
        setShareLinks(prev => prev.filter(s => s.id !== shareLinkId));
      } else {
        setError(response.message || 'Failed to revoke share link');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to revoke share link');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  const clearError = useCallback(() => setError(null), []);

  return {
    isLoading,
    error,
    shareLinks,
    createShareLink,
    listShareLinks,
    revokeShareLink,
    clearError,
  };
};