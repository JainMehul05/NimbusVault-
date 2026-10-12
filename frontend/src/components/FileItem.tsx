import React, { useState, useRef, useEffect } from 'react';
import { formatFileSize, getFileIcon } from '@hooks/useFileManager';

interface FileItemProps {
  file: {
    id: string;
    filename: string;
    sizeBytes: string;
    mimeType: string;
    category: string;
    folderId: string | null;
    status: string;
    uploadedAt: string;
  };
  onDownload: (file: any) => void;
  onRename: (file: any, newName: string) => void;
  onMove: (file: any, newFolderId: string | null) => void;
  onDelete: (file: any) => void;
  folders: any[];
  uploadProgress?: Record<string, number>;
}

export const FileItem: React.FC<FileItemProps> = ({
  file,
  onDownload,
  onRename,
  onMove,
  onDelete,
  folders,
  uploadProgress = {},
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(file.filename);
  const [isMoving, setIsMoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renameValue.trim() && renameValue !== file.filename) {
      onRename(file, renameValue.trim());
    }
    setIsRenaming(false);
  };

  const handleMoveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const folderId = formData.get('folderId') as string;
    onMove(file, folderId || null);
    setIsMoving(false);
  };

  const progress = uploadProgress[file.filename];

  return (
    <tr className={`hover:bg-gray-50 ${progress !== undefined ? 'opacity-75' : ''}`}>
      <td className="px-4 py-3 flex items-center space-x-3">
        <span className="text-2xl">{getFileIcon(file.mimeType, file.category)}</span>
        {isRenaming ? (
          <form onSubmit={handleRenameSubmit} className="flex-1 flex space-x-2">
            <input
              ref={inputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="flex-1 px-2 py-1 border border-blue-500 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoComplete="off"
            />
            <button type="submit" className="px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700">Save</button>
            <button type="button" onClick={() => setIsRenaming(false)} className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900">Cancel</button>
          </form>
        ) : (
          <span className="font-medium text-gray-900 truncate max-w-xs">{file.filename}</span>
        )}
        {progress !== undefined && (
          <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }}></div>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">
        {formatFileSize(file.sizeBytes)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell">
        {new Date(file.uploadedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center space-x-2">
          {!isRenaming && !isMoving && (
            <>
              <button
                onClick={() => onDownload(file)}
                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Download"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              <button
                onClick={() => setIsRenaming(true)}
                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Rename"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => setIsMoving(true)}
                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Move"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
              <button
                onClick={() => onDelete(file)}
                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                title="Delete"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
          {isMoving && (
            <form onSubmit={handleMoveSubmit} className="flex items-center space-x-2">
              <select name="folderId" className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">Root</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{'  '.repeat(folder.depth)}📁 {folder.name}</option>
                ))}
              </select>
              <button type="submit" className="p-1.5 text-white bg-blue-600 rounded hover:bg-blue-700" title="Confirm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <button type="button" onClick={() => setIsMoving(false)} className="p-1.5 text-gray-500 hover:text-gray-900" title="Cancel">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
};