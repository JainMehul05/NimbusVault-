import React from 'react';
import { FileItem } from './FileItem';
import type { FileManagerReturn } from '@hooks/useFileManager';

interface FileListProps {
  fileManager: FileManagerReturn;
}

export const FileList: React.FC<FileListProps> = ({ fileManager }) => {
  const {
    files,
    folders,
    isLoading,
    error,
    pagination,
    uploadProgress,
    handleDownload,
    handleRename,
    handleMove,
    handleDelete,
    fetchFiles,
  } = fileManager;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <svg className="mx-auto h-16 w-16 text-muted-foreground/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <p className="mt-4 text-lg">No files in this folder</p>
        <p className="mt-1">Drag and drop files or click upload to add files</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Size</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Modified</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-card divide-y divide-border">
          {files.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              onDownload={handleDownload}
              onRename={handleRename}
              onMove={handleMove}
              onDelete={handleDelete}
              folders={folders}
              uploadProgress={uploadProgress}
            />
          ))}
        </tbody>
      </table>
      
      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} files)
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => fetchFiles(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="px-3 py-1 text-sm font-medium text-muted-foreground bg-card border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => fetchFiles(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
              className="px-3 py-1 text-sm font-medium text-muted-foreground bg-card border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
      
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};