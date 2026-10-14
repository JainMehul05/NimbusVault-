import React, { useEffect, useState } from 'react';
import { useAuth } from '@context/AuthContext';
import { useFileManager } from '@hooks/useFileManager';
import { useSharing } from '@hooks/useSharing';
import { FileList } from '@components/FileList';

export const SharedWithMePage: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'files' | 'folders'>('files');

  const fileManager = useFileManager();
  const sharing = useSharing();

  useEffect(() => {
    if (user) {
      sharing.fetchSharedWithMe();
    }
  }, [user, sharing]);

  const sharedFiles = sharing.sharedWithMe?.files || [];
  const sharedFolders = sharing.sharedWithMe?.folders || [];

  return (
    <div className="min-h-screen bg-background">
      <nav className="bg-card border-b border-border sticky top-0 z-10">
        <div className="container-custom">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-foreground">NimbusVault</h1>
              <span className="ml-4 px-2 py-1 text-xs font-medium bg-primary/10 text-primary rounded">
                Shared with me
              </span>
            </div>
          </div>
        </div>
      </nav>

      <main className="container-custom py-6">
        {/* Tabs */}
        <div className="flex border-b border-border mb-6">
          <button
            onClick={() => setActiveTab('files')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'files'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Files ({sharedFiles.length})
          </button>
          <button
            onClick={() => setActiveTab('folders')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'folders'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Folders ({sharedFolders.length})
          </button>
        </div>

        {activeTab === 'files' ? (
          <FileList
            fileManager={{
              ...fileManager,
              files: sharedFiles.map(f => ({
                ...f,
                status: 'READY',
                uploadedAt: f.owner?.name || '',
              })),
              isLoading: sharing.isLoading,
              error: sharing.error,
              handleDownload: fileManager.handleDownload,
              handleRename: fileManager.handleRename,
              handleMove: fileManager.handleMove,
              handleDelete: fileManager.handleDelete,
              fetchFiles: async () => { await sharing.fetchSharedWithMe(); },
            }}
          />
        ) : (
          <div className="bg-card rounded-lg border border-border p-6">
            {sharedFolders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <svg className="mx-auto h-16 w-16 text-muted-foreground/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="mt-4 text-lg">No shared folders</p>
                <p className="mt-1">Folders shared with you will appear here</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sharedFolders.map((folder) => (
                  <div
                    key={folder.id}
                    className="p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-3xl">📁</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{folder.name}</p>
                        <p className="text-sm text-muted-foreground">Shared by {folder.owner?.name}</p>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded ${
                        folder.permission === 'EDITOR'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {folder.permission}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error Toast */}
        {sharing.error && (
          <div className="fixed bottom-4 right-4 z-50 animate-slide-in">
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 shadow-lg max-w-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <svg className="w-5 h-5 text-destructive" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 001.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-destructive">{sharing.error}</p>
                </div>
                <button
                  onClick={() => sharing.clearError()}
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