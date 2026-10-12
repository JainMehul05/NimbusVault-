import React, { useState } from 'react';
import type { FileManagerReturn, Folder } from '@hooks/useFileManager';

interface FolderTreeProps {
  fileManager: FileManagerReturn;
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
  onDeleteFolder: (folderId: string) => void;
}

const FolderNode: React.FC<{
  folder: Folder;
  fileManager: FileManagerReturn;
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
  onDeleteFolder: (folderId: string) => void;
  depth: number;
}> = ({
  folder,
  fileManager,
  currentFolderId,
  onNavigate,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  depth,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const handleCreateSubFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFolderName.trim()) {
      onCreateFolder(folder.id, newFolderName.trim());
      setShowCreateFolder(false);
      setNewFolderName('');
    }
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renameValue.trim() && renameValue !== folder.name) {
      onRenameFolder(folder.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  const handleDelete = () => {
    if (window.confirm(`Delete folder "${folder.name}" and all its contents?`)) {
      onDeleteFolder(folder.id);
    }
  };

  const hasChildren = (folder.children?.length ?? 0) > 0;

  return (
    <div className="select-none">
      <div
        className={`flex items-center space-x-1 py-1 px-2 rounded hover:bg-gray-100 transition-colors ${
          currentFolderId === folder.id ? 'bg-blue-50 text-blue-700 font-medium' : ''
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {hasChildren && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </button>
        )}

        <button
          onClick={() => onNavigate(folder.id)}
          className={`flex-1 flex items-center space-x-2 text-left ${isRenaming ? 'hidden' : ''}`}
        >
          <span className="text-lg">📁</span>
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} className="flex-1 flex space-x-1">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="flex-1 px-1 py-0.5 border border-blue-500 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button type="submit" className="px-1.5 py-0.5 text-xs text-white bg-blue-600 rounded hover:bg-blue-700">✓</button>
              <button type="button" onClick={() => setIsRenaming(false)} className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-700">✕</button>
            </form>
          ) : (
            <span className="truncate font-medium text-sm">{folder.name}</span>
          )}
        </button>

        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100">
          {!isRenaming && (
            <>
              <button
                onClick={() => setShowCreateFolder(!showCreateFolder)}
                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                title="Create subfolder"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </button>
              <button
                onClick={() => setIsRenaming(true)}
                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                title="Rename"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={handleDelete}
                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {showCreateFolder && (
        <form onSubmit={handleCreateSubFolder} className="flex items-center space-x-1 mt-1" style={{ paddingLeft: `${12 + depth * 16}px` }}>
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="New folder name"
            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <button type="submit" className="px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700">Create</button>
          <button type="button" onClick={() => { setShowCreateFolder(false); setNewFolderName(''); }} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
        </form>
      )}

      {isExpanded && folder.children?.map((childFolder: Folder) => (
          <FolderNode
            key={childFolder.id}
            folder={childFolder}
            fileManager={fileManager}
            currentFolderId={currentFolderId}
            onNavigate={onNavigate}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            depth={depth + 1}
          />
        ))
      }
    </div>
  );
};

export const FolderTree: React.FC<FolderTreeProps> = ({
  fileManager,
  currentFolderId,
  onNavigate,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}) => {
  const rootFolders = fileManager.folderTree;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Folders</h3>
        <button
          onClick={() => {
            const name = prompt('Folder name:');
            if (name?.trim()) onCreateFolder(null, name.trim());
          }}
          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
          title="Create root folder"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>
      </div>

      <button
        onClick={() => onNavigate(null)}
        className={`w-full flex items-center space-x-2 py-2 px-3 rounded transition-colors ${
          currentFolderId === null
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <span className="text-lg">🏠</span>
        <span className="font-medium text-sm">Root</span>
      </button>

      <div className="mt-2 border-t border-gray-100 pt-2">
        {rootFolders.map((folder) => (
          <FolderNode
            key={folder.id}
            folder={folder}
            fileManager={fileManager}
            currentFolderId={currentFolderId}
            onNavigate={onNavigate}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            depth={0}
          />
        ))}
      </div>

      {rootFolders.length === 0 && (
        <div className="mt-4 text-center text-gray-500 text-sm">
          <p>No folders yet</p>
          <p className="text-xs">Click + to create your first folder</p>
        </div>
      )}
    </div>
  );
};