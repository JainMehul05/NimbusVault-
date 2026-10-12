import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@context/AuthContext';
import { api, type ApiResponse } from '@services/api';

export interface File {
  id: string;
  filename: string;
  sizeBytes: string;
  mimeType: string;
  category: string;
  folderId: string | null;
  status: string;
  uploadedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  parentFolderId: string | null;
  depth: number;
  createdAt: string;
  updatedAt: string;
  childrenCount: number;
  filesCount: number;
  children?: Folder[];
}

export interface StorageInfo {
  quota: string;
  used: string;
  remaining: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface FileListData {
  files: File[];
  pagination: PaginationInfo;
}

export interface FolderListData {
  folders: Folder[];
  pagination: PaginationInfo;
}

type UploadProgressMap = Record<string, number>;

export type FileManagerReturn = ReturnType<typeof useFileManager>;

export const formatFileSize = (bytes: string | number): string => {
  const numBytes = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (numBytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(numBytes) / Math.log(k));
  return `${parseFloat((numBytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export const getFileIcon = (_mimeType: string, category: string): string => {
  if (category === 'image') return '🖼️';
  if (category === 'video') return '🎬';
  if (category === 'pdf') return '📄';
  if (category === 'document') return '📝';
  return '📎';
};

export const useFileManager = () => {
  const { user, isAuthenticated } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderTree, setFolderTree] = useState<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<Folder[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressMap>({});
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [searchQuery, setSearchQuery] = useState('');

  const fetchStorageInfo = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    try {
      const response = await api.get<ApiResponse<StorageInfo>>('/files/storage/info');
      if (response.data.success && response.data.data) {
        setStorageInfo(response.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch storage info:', err);
    }
  }, [isAuthenticated, user]);

  const fetchFiles = useCallback(async (page = 1) => {
    if (!isAuthenticated || !user) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        sortBy: 'uploadedAt',
        sortOrder: 'desc',
      });
      if (currentFolderId) params.append('folderId', currentFolderId);
      if (searchQuery) params.append('search', searchQuery);

      const response = await api.get<ApiResponse<FileListData>>(`/files?${params.toString()}`);
      if (response.data.success && response.data.data) {
        setFiles(response.data.data.files);
        setPagination(response.data.data.pagination);
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to load files');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user, currentFolderId, searchQuery]);

  const fetchFolders = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    try {
      const params = new URLSearchParams({
        page: '1',
        limit: '100',
        sortBy: 'name',
        sortOrder: 'asc',
      });
      if (currentFolderId !== null) {
        params.append('parentFolderId', currentFolderId);
      } else {
        params.append('parentFolderId', '');
      }

      const response = await api.get<ApiResponse<FolderListData>>(`/folders?${params.toString()}`);
      if (response.data.success && response.data.data) {
        setFolders(response.data.data.folders);
      }
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  }, [isAuthenticated, user, currentFolderId]);

  const fetchFolderPath = useCallback(async () => {
    if (!isAuthenticated || !user || !currentFolderId) {
      setFolderPath([]);
      return;
    }
    try {
      const response = await api.get<ApiResponse<Folder>>(`/folders/${currentFolderId}/contents`);
      if (response.data.success && response.data.data) {
        // Build path from root to current folder
        const path: Folder[] = [];
        const current = response.data.data as Folder & { parentFolder?: Folder };
        path.unshift(current);
        // We'd need a separate API call to get parent, for now just use what we have
        setFolderPath(path);
      }
    } catch (err) {
      console.error('Failed to load folder path:', err);
    }
  }, [isAuthenticated, user, currentFolderId]);

  const fetchFolderTree = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    try {
      const params = new URLSearchParams();
      if (currentFolderId !== null) {
        params.append('folderId', currentFolderId);
      }
      const response = await api.get<ApiResponse<Folder[]>>(`/folders/tree?${params.toString()}`);
      if (response.data.success && response.data.data) {
        setFolderTree(response.data.data);
      }
    } catch (err) {
      console.error('Failed to load folder tree:', err);
    }
  }, [isAuthenticated, user, currentFolderId]);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchStorageInfo();
      fetchFiles();
      fetchFolders();
      fetchFolderPath();
      fetchFolderTree();
    }
  }, [isAuthenticated, user, fetchStorageInfo, fetchFiles, fetchFolders, fetchFolderPath, fetchFolderTree]);

  const handleUpload = async (fileList: FileList) => {
    if (!isAuthenticated || !user) return;
    
    const filesArray = Array.from(fileList);
    setIsUploading(true);
    
    for (const file of filesArray) {
      setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));
      
      try {
        const formData = new FormData();
        formData.append('file', file);
        if (currentFolderId) {
          formData.append('folderId', currentFolderId);
        }

        const response = await api.post<ApiResponse<File>>('/files', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setUploadProgress(prev => ({ ...prev, [file.name]: progress }));
            }
          },
        });

        if (response.data.success) {
          setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
          // Refresh file list
          fetchFiles(pagination.page);
          fetchStorageInfo();
        } else {
          setError(response.data.message || `Failed to upload ${file.name}`);
        }
      } catch (err: unknown) {
        const axiosError = err as { response?: { data?: { message?: string } } };
        setError(axiosError.response?.data?.message || `Failed to upload ${file.name}`);
      }
    }
    
    setIsUploading(false);
    // Clear progress after a delay
    setTimeout(() => setUploadProgress({}), 2000);
  };

  const handleDownload = async (file: File) => {
    try {
      const response = await api.get<ApiResponse<{ downloadUrl: string }>>(`/files/${file.id}/download`);
      if (response.data.success && response.data.data) {
        const { downloadUrl } = response.data.data;
        window.open(downloadUrl, '_blank');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to download file');
    }
  };

  const handleRename = async (file: File, newName: string) => {
    try {
      const response = await api.patch<ApiResponse<File>>(`/files/${file.id}/rename`, { filename: newName });
      if (response.data.success) {
        fetchFiles(pagination.page);
      } else {
        setError(response.data.message || 'Failed to rename file');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to rename file');
    }
  };

  const handleMove = async (file: File, newFolderId: string | null) => {
    try {
      const response = await api.patch<ApiResponse<File>>(`/files/${file.id}/move`, { folderId: newFolderId });
      if (response.data.success) {
        fetchFiles(pagination.page);
      } else {
        setError(response.data.message || 'Failed to move file');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to move file');
    }
  };

  const handleDelete = async (file: File) => {
    if (!window.confirm(`Are you sure you want to delete "${file.filename}"?`)) return;
    
    try {
      const response = await api.delete<ApiResponse<File>>(`/files/${file.id}`);
      if (response.data.success) {
        fetchFiles(pagination.page);
        fetchStorageInfo();
      } else {
        setError(response.data.message || 'Failed to delete file');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to delete file');
    }
  };

  const handleCreateFolder = async (name: string) => {
    try {
      const response = await api.post<ApiResponse<Folder>>('/folders', { 
        name, 
        parentFolderId: currentFolderId 
      });
      if (response.data.success) {
        fetchFolders();
      } else {
        setError(response.data.message || 'Failed to create folder');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to create folder');
    }
  };

  const handleNavigateToFolder = (folderId: string | null) => {
    setCurrentFolderId(folderId);
    setSearchQuery('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleNavigateUp = () => {
    if (folderPath.length > 1) {
      const parentFolder = folderPath[folderPath.length - 2];
      setCurrentFolderId(parentFolder.id);
      setSearchQuery('');
      setPagination(prev => ({ ...prev, page: 1 }));
    } else {
      setCurrentFolderId(null);
      setSearchQuery('');
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  return {
    files,
    folders,
    folderTree,
    currentFolderId,
    folderPath,
    storageInfo,
    isLoading,
    isUploading,
    uploadProgress,
    error,
    pagination,
    searchQuery,
    setSearchQuery,
    fetchFiles,
    fetchFolders,
    fetchFolderTree,
    fetchStorageInfo,
    handleUpload,
    handleDownload,
    handleRename,
    handleMove,
    handleDelete,
    handleCreateFolder,
    handleNavigateToFolder,
    handleNavigateUp,
  };
};