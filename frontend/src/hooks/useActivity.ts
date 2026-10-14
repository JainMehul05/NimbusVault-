import { useState, useCallback } from 'react';
import { useAuth } from '@context/AuthContext';
import { activityApi, type ActivityLogFilters, type ActivityLogResponse } from '@services/activity';

export const useActivity = () => {
  const { isAuthenticated, user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityLogResponse | null>(null);

  const fetchActivityLog = useCallback(async (filters: ActivityLogFilters) => {
    if (!isAuthenticated || !user) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await activityApi.getActivityLog(filters);
      if (response.success && response.data) {
        setActivity(response.data);
        return response.data;
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to load activity log');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  const fetchMyActivity = useCallback(async (page = 1, limit = 20) => {
    if (!isAuthenticated || !user) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await activityApi.getMyActivity(page, limit);
      if (response.success && response.data) {
        setActivity(response.data);
        return response.data;
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to load activity');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  const fetchResourceActivity = useCallback(async (
    resourceType: 'FILE' | 'FOLDER' | 'SHARE_LINK' | 'USER',
    resourceId: string,
    page = 1,
    limit = 20
  ) => {
    if (!isAuthenticated || !user) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await activityApi.getResourceActivity(resourceType, resourceId, page, limit);
      if (response.success && response.data) {
        setActivity(response.data);
        return response.data;
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to load resource activity');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  const clearError = useCallback(() => setError(null), []);

  return {
    isLoading,
    error,
    activity,
    fetchActivityLog,
    fetchMyActivity,
    fetchResourceActivity,
    clearError,
  };
};