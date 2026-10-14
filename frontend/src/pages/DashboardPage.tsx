import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Clock, LogOut } from 'lucide-react';
import { useAuth } from '@context/AuthContext';
import { useFileManager } from '@hooks/useFileManager';
import { useSharing } from '@hooks/useSharing';
import { UploadZone } from '@components/UploadZone';
import { FileList } from '@components/FileList';
import { FolderTree } from '@components/FolderTree';
import { StorageIndicator } from '@components/StorageIndicator';
import { Breadcrumb } from '@components/Breadcrumb';
import { SearchBar } from '@components/SearchBar';
import { ShareDialog } from '@components/ShareDialog';
import { ShareLinkDialog } from '@components/ShareLinkDialog';

export const DashboardPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog states
  const [shareDialog, setShareDialog] = useState<{
    isOpen: boolean;
    resourceType: 'FILE' | 'FOLDER';
    resourceId: string;
    resourceName: string;
  } | null>(null);

  const [shareLinkDialog, setShareLinkDialog] = useState<{
    isOpen: boolean;
    fileId: string;
    fileName: string;
  } | null>(null);

  const fileManager = useFileManager();
  const sharing = useSharing();

  // Override search handling
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const handleSearch = useCallback((value: string) => {
    fileManager.setSearchQuery(value);
    fileManager.fetchFiles(1);
  }, [fileManager]);

  const handleCreateFolder = useCallback((_parentId: string | null, name: string) => {
    fileManager.handleCreateFolder(name);
  }, [fileManager]);

  const handleRenameFolder = useCallback((folderId: string, newName: string) => {
    console.log('Rename folder:', folderId, newName);
  }, []);

  const handleDeleteFolder = useCallback((folderId: string) => {
    console.log('Delete folder:', folderId);
  }, []);

  const handleNavigate = useCallback((folderId: string | null) => {
    fileManager.handleNavigateToFolder(folderId);
  }, [fileManager]);

  // Share handlers
  const handleShare = useCallback((file: any) => {
    setShareDialog({
      isOpen: true,
      resourceType: 'FILE',
      resourceId: file.id,
      resourceName: file.filename,
    });
  }, []);

  const handleCreateShareLink = useCallback((file: any) => {
    setShareLinkDialog({
      isOpen: true,
      fileId: file.id,
      fileName: file.filename,
    });
  }, []);

  // Clear error when user interacts
  const clearError = useCallback(() => setError(null), []);

  return (
    <div className="min-h-screen bg-background" onClick={clearError}>
      <nav className="bg-card border-b border-border sticky top-0 z-10">
        <div className="container-custom">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-6">
              <h1 className="text-xl font-bold text-foreground">NimbusVault</h1>
              <nav className="hidden md:flex items-center space-x-4">
                <Link
                  to="/dashboard"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Files
                </Link>
                <Link
                  to="/shared-with-me"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <Users className="w-4 h-4" />
                  Shared with me
                </Link>
                <Link
                  to="/activity"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <Clock className="w-4 h-4" />
                  Activity
                </Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground hidden sm:block">Welcome, {user?.name}</span>
              <button
                onClick={() => logout()}
                className="px-4 py-2 text-sm font-medium text-destructive-foreground bg-destructive rounded-md hover:bg-destructive/90 transition-colors flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="container-custom py-6">
        {/* Error Toast */}
        {(fileManager.error || error) && (
          <div className="fixed top-20 right-4 z-50 max-w-md animate-slide-in" role="alert">
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <svg className="w-5 h-5 text-destructive" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-destructive">{fileManager.error || error}</p>
                </div>
                <button
                  onClick={() => { setError(null); fileManager.fetchFiles(fileManager.pagination.page); }}
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sidebar - Folder Tree */}
          <aside className="lg:col-span-3 xl:col-span-2">
            <FolderTree
              fileManager={fileManager}
              currentFolderId={fileManager.currentFolderId}
              onNavigate={handleNavigate}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
            />

            {/* Storage Indicator */}
            <div className="mt-6">
              <StorageIndicator storageInfo={fileManager.storageInfo} />
            </div>
          </aside>

          {/* Main Content - File List */}
          <div className="lg:col-span-9 xl:col-span-10">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div className="flex items-center space-x-4">
                <Breadcrumb
                  folderPath={fileManager.folderPath}
                  currentFolderId={fileManager.currentFolderId}
                  onNavigate={handleNavigate}
                />
              </div>
              <div className="flex items-center space-x-4 w-full sm:w-auto">
                <SearchBar
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onSearch={handleSearch}
                  placeholder="Search files..."
                />
                <UploadZone
                  fileManager={fileManager}
                  onFileSelect={fileManager.handleUpload}
                />
              </div>
            </div>

            {/* File List */}
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <FileList
                fileManager={fileManager}
                onShare={handleShare}
                onCreateShareLink={handleCreateShareLink}
              />
            </div>

            {/* Empty state for when no files but not loading */}
            {!fileManager.isLoading && fileManager.files.length === 0 && !fileManager.isUploading && (
              <div className="mt-6 text-center">
                <svg className="mx-auto h-16 w-16 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 002-2h-6l-2-2H5a2 2 0 002-2z" />
                </svg>
                <p className="mt-4 text-lg text-muted-foreground">No files in this folder</p>
                <p className="mt-1 text-sm text-muted-foreground">Drag and drop files above or click the upload area to add files</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Share Dialog */}
      {shareDialog && (
        <ShareDialog
          isOpen={shareDialog.isOpen}
          onClose={() => setShareDialog(null)}
          resourceType={shareDialog.resourceType}
          resourceId={shareDialog.resourceId}
          resourceName={shareDialog.resourceName}
          onShare={async (granteeEmail, level) => {
            await sharing.createShare({
              resourceType: shareDialog.resourceType,
              resourceId: shareDialog.resourceId,
              granteeEmail,
              level,
            });
            // Refresh shares list
            sharing.listShares(shareDialog.resourceType, shareDialog.resourceId);
          }}
          existingShares={sharing.shares}
        />
      )}

      {/* Share Link Dialog */}
      {shareLinkDialog && (
        <ShareLinkDialog
          isOpen={shareLinkDialog.isOpen}
          onClose={() => setShareLinkDialog(null)}
          fileId={shareLinkDialog.fileId}
          fileName={shareLinkDialog.fileName}
        />
      )}
    </div>
  );
};