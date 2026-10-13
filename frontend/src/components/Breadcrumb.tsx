import React from 'react';
import type { Folder } from '@hooks/useFileManager';

interface BreadcrumbProps {
  folderPath: Folder[];
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ folderPath, currentFolderId, onNavigate }) => {
  const pathItems = [
    { id: null, name: 'Root' },
    ...folderPath,
  ];

  return (
    <nav className="flex items-center space-x-2 text-sm" aria-label="Folder navigation">
      {pathItems.map((item, index) => (
        <React.Fragment key={item.id || 'root'}>
          {index > 0 && (
            <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
          <button
            onClick={() => onNavigate(item.id)}
            className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors ${
              item.id === currentFolderId
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            }`}
            aria-current={item.id === currentFolderId ? 'page' : undefined}
          >
            <span className="text-lg">{item.id === null ? '🏠' : '📁'}</span>
            <span className="truncate max-w-[150px]">{item.name}</span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
};