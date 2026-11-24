import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@context/AuthContext';
import { getErrorMessage } from '@lib/format';
import {
  filesApi,
  findNode,
  flattenTree,
  foldersApi,
  MAX_UPLOAD_BYTES,
  pathTo,
  type FileRecord,
  type FileSortField,
  type FolderNode,
  type Pagination,
  type StorageInfo,
} from '@services/files';

export type { FileRecord, FolderNode, StorageInfo } from '@services/files';
export { formatFileSize } from '@lib/format';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

export interface SortState {
  by: FileSortField;
  order: 'asc' | 'desc';
}

const PAGE_SIZE = 50;

/**
 * State and actions for one folder view. The whole folder tree is fetched once (a single
 * request) and used for breadcrumbs, subfolders, the sidebar tree, and move targets.
 */
export const useFileManager = (currentFolderId: string | null) => {
  const { isAuthenticated } = useAuth();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<SortState>({ by: 'uploadedAt', order: 'desc' });
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const requestSeq = useRef(0);

  const fetchStorage = useCallback(async () => {
    try { setStorage(await filesApi.storage()); } catch { /* non-blocking */ }
  }, []);

  const fetchTree = useCallback(async () => {
    try {
      setTree(await foldersApi.tree());
    } catch (err) {
      setError(getErrorMessage(err, 'Couldn’t load your folders.'));
    } finally {
      setTreeLoaded(true);
    }
  }, []);

  const fetchFiles = useCallback(async (page = 1) => {
    if (!isAuthenticated) return;
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await filesApi.list({
        // A search looks across every folder; otherwise list only this folder's direct files.
        folderId: search ? undefined : currentFolderId,
        search: search || undefined,
        category: category || undefined,
        page,
        limit: PAGE_SIZE,
        sortBy: sort.by,
        sortOrder: sort.order,
      });
      if (seq !== requestSeq.current) return;
      setFiles(data.files);
      setPagination(data.pagination);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(getErrorMessage(err, 'Couldn’t load files.'));
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [isAuthenticated, currentFolderId, search, category, sort]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchTree();
    fetchStorage();
  }, [isAuthenticated, fetchTree, fetchStorage]);

  useEffect(() => { fetchFiles(1); }, [fetchFiles]);

  // While any visible file is queued or being indexed, refresh quietly so its AI badge updates.
  const indexing = files.some((f) => f.aiStatus === 'PENDING' || f.aiStatus === 'PROCESSING')
  useEffect(() => {
    if (!indexing) return
    const t = window.setInterval(async () => {
      try {
        const data = await filesApi.list({
          folderId: search ? undefined : currentFolderId,
          search: search || undefined,
          category: category || undefined,
          page: pagination.page,
          limit: PAGE_SIZE,
          sortBy: sort.by,
          sortOrder: sort.order,
        })
        setFiles(data.files)
      } catch { /* transient; next tick retries */ }
    }, 4000)
    return () => window.clearInterval(t)
  }, [indexing, currentFolderId, search, category, sort, pagination.page])

  // Leaving a folder clears its search so the next folder opens unfiltered.
  useEffect(() => { setSearch(''); }, [currentFolderId]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchFiles(pagination.page), fetchTree(), fetchStorage()]);
  }, [fetchFiles, fetchTree, fetchStorage, pagination.page]);

  // ---- Derived folder data ----
  const allFolders = useMemo(() => flattenTree(tree), [tree]);
  const folderPath = useMemo(() => pathTo(tree, currentFolderId), [tree, currentFolderId]);
  const currentFolder = useMemo(() => findNode(tree, currentFolderId), [tree, currentFolderId]);
  const subfolders = useMemo(() => {
    const list = currentFolderId ? currentFolder?.children ?? [] : tree;
    const filtered = search ? allFolders.filter((f) => f.name.toLowerCase().includes(search.toLowerCase())) : list;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [tree, currentFolder, currentFolderId, search, allFolders]);
  const folderMissing = treeLoaded && currentFolderId !== null && !currentFolder;

  // ---- File actions (throw on failure; callers show feedback) ----
  const renameFile = async (file: FileRecord, name: string) => {
    await filesApi.rename(file.id, name);
    setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, filename: name } : f)));
  };

  const moveFiles = async (ids: string[], folderId: string | null) => {
    const results = await Promise.allSettled(ids.map((id) => filesApi.move(id, folderId)));
    await fetchFiles(pagination.page);
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) throw failed[0].reason;
  };

  const deleteFiles = async (ids: string[]) => {
    const results = await Promise.allSettled(ids.map((id) => filesApi.remove(id)));
    await Promise.all([fetchFiles(pagination.page), fetchStorage()]);
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) throw failed[0].reason;
  };

  // ---- Folder actions ----
  const createFolder = async (name: string, parentId: string | null = currentFolderId) => {
    await foldersApi.create(name, parentId);
    await fetchTree();
  };
  const renameFolder = async (id: string, name: string) => {
    await foldersApi.rename(id, name);
    await fetchTree();
  };
  const moveFolder = async (id: string, parentId: string | null) => {
    await foldersApi.move(id, parentId);
    await fetchTree();
  };
  const deleteFolder = async (id: string) => {
    await foldersApi.remove(id);
    await Promise.all([fetchTree(), fetchStorage(), fetchFiles(1)]);
  };

  // ---- Uploads ----
  const upload = async (list: FileList | File[]) => {
    const picked = Array.from(list);
    if (!picked.length) return;
    let remaining = storage ? Number(storage.remaining) : Infinity;
    const items: UploadItem[] = picked.map((f, i) => {
      const id = `${Date.now()}-${i}-${f.name}`;
      if (f.size > MAX_UPLOAD_BYTES) return { id, name: f.name, size: f.size, progress: 0, status: 'error', error: 'Larger than the 100 MB limit' };
      if (f.size > remaining) return { id, name: f.name, size: f.size, progress: 0, status: 'error', error: 'Not enough storage left' };
      remaining -= f.size;
      return { id, name: f.name, size: f.size, progress: 0, status: 'queued' };
    });
    setUploads((prev) => [...prev.filter((u) => u.status === 'uploading' || u.status === 'queued'), ...items]);
    const targetFolder = currentFolderId;

    for (let i = 0; i < picked.length; i++) {
      const item = items[i];
      if (item.status === 'error') continue;
      const patch = (p: Partial<UploadItem>) => setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, ...p } : u)));
      patch({ status: 'uploading' });
      try {
        await filesApi.upload(picked[i], targetFolder, (progress) => patch({ progress }));
        patch({ status: 'done', progress: 100 });
      } catch (err) {
        patch({ status: 'error', error: getErrorMessage(err, 'Upload failed') });
      }
    }
    await Promise.all([fetchFiles(1), fetchStorage()]);
  };

  const clearFinishedUploads = () => setUploads((prev) => prev.filter((u) => u.status === 'uploading' || u.status === 'queued'));

  return {
    files,
    pagination,
    tree,
    treeLoaded,
    allFolders,
    folderPath,
    currentFolder,
    subfolders,
    folderMissing,
    storage,
    isLoading,
    error,
    search,
    setSearch,
    category,
    setCategory,
    sort,
    setSort,
    uploads,
    fetchFiles,
    refresh,
    renameFile,
    moveFiles,
    deleteFiles,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    upload,
    clearFinishedUploads,
  };
};

export type FileManager = ReturnType<typeof useFileManager>;
