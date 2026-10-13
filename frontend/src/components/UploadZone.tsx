import React, { useCallback, useRef, useState } from 'react';
import type { FileManagerReturn } from '@hooks/useFileManager';
import type { DragEvent } from 'react';

interface UploadZoneProps {
  fileManager: FileManagerReturn;
  onFileSelect: (files: FileList) => void;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ fileManager, onFileSelect }) => {
  const { isUploading, uploadProgress } = fileManager;
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileSelect(e.dataTransfer.files);
    }
  }, [onFileSelect]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files);
    }
    // Reset input value to allow selecting same file again
    e.target.value = '';
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const hasProgress = Object.keys(uploadProgress).length > 0;

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
        isDragActive 
          ? 'border-primary bg-primary/10' 
          : 'border-border hover:border-primary hover:bg-muted/50'
      } ${isUploading || hasProgress ? 'opacity-75 pointer-events-none' : ''}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label="Upload files"
        disabled={isUploading || hasProgress}
      />
      
      <div className="relative z-10">
        <svg
          className="mx-auto h-12 w-12 text-muted-foreground"
          stroke="currentColor"
          fill="none"
          viewBox="0 0 48 48"
          aria-hidden="true"
        >
          <path
            d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l9.172 9.172a4 4 0 005.656 0L28 28"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        
        <p className="mt-2 text-lg font-medium text-foreground">
          {isUploading || hasProgress ? 'Uploading...' : 'Drag and drop files here, or click to select'}
        </p>
        
        <p className="mt-1 text-sm text-muted-foreground">
          Supports: PDF, Images, Videos, Documents (max 100MB each)
        </p>
        
        {(isUploading || hasProgress) && (
          <div className="mt-4 space-y-2 max-w-md mx-auto">
            {Object.entries(uploadProgress).map(([filename, progress]) => (
              <div key={filename} className="text-left">
                <div className="flex justify-between text-sm mb-1">
                  <span className="truncate pr-2">{filename}</span>
                  <span className="text-muted-foreground">{progress}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};