import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@context/AuthContext';
import { useActivity } from '@hooks/useActivity';
import { cn } from '@lib/utils';
import type { ActivityAction } from '@services/activity';

const actionLabels: Record<ActivityAction, string> = {
  auth_login: 'Login',
  auth_failed_login: 'Failed Login',
  auth_logout: 'Logout',
  auth_password_change: 'Password Change',
  file_upload: 'File Upload',
  file_download: 'File Download',
  file_delete: 'File Delete',
  file_restore: 'File Restore',
  file_rename: 'File Rename',
  file_move: 'File Move',
  folder_create: 'Folder Create',
  folder_delete: 'Folder Delete',
  share_create: 'Share Created',
  share_revoke: 'Share Revoked',
  share_access: 'Share Accessed',
  ai_query: 'AI Query',
};

const actionColors: Record<ActivityAction, string> = {
  auth_login: 'text-green-500',
  auth_failed_login: 'text-red-500',
  auth_logout: 'text-gray-500',
  auth_password_change: 'text-blue-500',
  file_upload: 'text-blue-500',
  file_download: 'text-green-500',
  file_delete: 'text-red-500',
  file_restore: 'text-green-500',
  file_rename: 'text-yellow-500',
  file_move: 'text-purple-500',
  folder_create: 'text-blue-500',
  folder_delete: 'text-red-500',
  share_create: 'text-indigo-500',
  share_revoke: 'text-orange-500',
  share_access: 'text-teal-500',
  ai_query: 'text-violet-500',
};

export const ActivityPage: React.FC = () => {
  const { user } = useAuth();
  const activity = useActivity();
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [filters, setFilters] = useState<{
    action?: ActivityAction;
    resourceType?: 'FILE' | 'FOLDER' | 'SHARE_LINK' | 'USER';
    startDate?: string;
    endDate?: string;
  }>({});

  const fetchActivity = useCallback(async () => {
    await activity.fetchActivityLog({
      ...filters,
      page,
      limit,
      userId: user?.id,
    });
  }, [activity, filters, page, limit, user?.id]);

  useEffect(() => {
    if (user) {
      fetchActivity();
    }
  }, [user, fetchActivity]);

  const entries = activity.activity?.entries || [];

  return (
    <div className="min-h-screen bg-background">
      <nav className="bg-card border-b border-border sticky top-0 z-10">
        <div className="container-custom">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-foreground">NimbusVault</h1>
              <span className="ml-4 px-2 py-1 text-xs font-medium bg-primary/10 text-primary rounded">
                Activity History
              </span>
            </div>
          </div>
        </div>
      </nav>

      <main className="container-custom py-6">
        {/* Filters */}
        <div className="bg-card rounded-lg border border-border p-4 mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Filters</h2>
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Action</label>
              <select
                value={filters.action || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, action: e.target.value as ActivityAction || undefined }))}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Actions</option>
                {Object.entries(actionLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Resource Type</label>
              <select
                value={filters.resourceType || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, resourceType: e.target.value as any || undefined }))}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Types</option>
                <option value="FILE">File</option>
                <option value="FOLDER">Folder</option>
                <option value="SHARE_LINK">Share Link</option>
                <option value="USER">User</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">From</label>
              <input
                type="date"
                value={filters.startDate || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value || undefined }))}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">To</label>
              <input
                type="date"
                value={filters.endDate || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value || undefined }))}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>

        {/* Activity List */}
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          {activity.isLoading && (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
          )}

          {!activity.isLoading && entries.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <svg className="mx-auto h-16 w-16 text-muted-foreground/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="mt-4 text-lg">No activity found</p>
              <p className="mt-1">Try adjusting your filters</p>
            </div>
          )}

          <div className="divide-y divide-border">
            {entries.map((entry) => (
              <div key={entry.id} className="p-4 hover:bg-muted/30 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <span className={cn('text-lg', actionColors[entry.action] || 'text-foreground')}>
                      {(() => {
                        switch (entry.action) {
                          case 'auth_login': return '🔑';
                          case 'auth_failed_login': return '🔒';
                          case 'auth_logout': return '🚪';
                          case 'file_upload': return '📤';
                          case 'file_download': return '📥';
                          case 'file_delete': return '🗑️';
                          case 'file_rename': return '✏️';
                          case 'file_move': return '📦';
                          case 'folder_create': return '📁';
                          case 'folder_delete': return '📁';
                          case 'share_create': return '🔗';
                          case 'share_revoke': return '🔗';
                          case 'share_access': return '👁️';
                          default: return '📋';
                        }
                      })()}
                    </span>
                    <div>
                      <p className="font-medium text-foreground">{actionLabels[entry.action] || entry.action}</p>
                      <p className="text-sm text-muted-foreground">
                        {entry.user ? `${entry.user.name} (${entry.user.email})` : 'System'}
                        {entry.ipAddress && ` • ${entry.ipAddress}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                    {entry.resourceType && entry.resourceId && (
                      <span className="px-2 py-0.5 bg-muted rounded text-foreground">
                        {entry.resourceType}: {entry.resourceId.slice(0, 8)}...
                      </span>
                    )}
                    <span className="whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                  <div className="mt-2 ml-8 text-xs text-muted-foreground font-mono">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {activity.activity && activity.activity.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <div className="text-sm text-muted-foreground">
                Page {activity.activity.page} of {activity.activity.totalPages} ({activity.activity.total} entries)
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage(prev => prev - 1)}
                  disabled={page === 1 || activity.isLoading}
                  className="px-3 py-1 text-sm font-medium text-muted-foreground bg-background border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(prev => prev + 1)}
                  disabled={page === activity.activity?.totalPages || activity.isLoading}
                  className="px-3 py-1 text-sm font-medium text-muted-foreground bg-background border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Error Toast */}
        {activity.error && (
          <div className="fixed bottom-4 right-4 z-50 animate-slide-in">
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 shadow-lg max-w-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <svg className="w-5 h-5 text-destructive" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-destructive">{activity.error}</p>
                </div>
                <button
                  onClick={() => activity.clearError()}
                  className="text-destructive hover:text-destructive/80"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};