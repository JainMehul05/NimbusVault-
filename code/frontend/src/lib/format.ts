import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from 'lucide-react';

export const formatFileSize = (bytes: string | number | bigint | null | undefined): string => {
  const numBytes = typeof bytes === 'number' ? bytes : Number(bytes ?? 0);
  if (!Number.isFinite(numBytes) || numBytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(numBytes) / Math.log(k)), sizes.length - 1);
  const value = numBytes / Math.pow(k, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : parseFloat(value.toFixed(1))} ${sizes[i]}`;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export const formatDate = (value: string | Date | null | undefined): string => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateFormatter.format(d);
};

export const formatDateTime = (value: string | Date | null | undefined): string => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFormatter.format(d);
};

export const formatTime = (value: string | Date): string => timeFormatter.format(new Date(value));

/** "just now", "5 min ago", "3 h ago", "Yesterday", then a short date. */
export const formatRelative = (value: string | Date | null | undefined): string => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < 24 * hour && isSameDay(d, new Date())) return `${Math.floor(diff / hour)} h ago`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return formatDate(d);
};

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Day heading for grouped timelines: Today / Yesterday / Mon, Nov 10, 2026. */
export const formatDayHeading = (value: string | Date): string => {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
};

/** Pulls the most useful message out of an Axios error (including Zod validation details). */
export const getErrorMessage = (err: unknown, fallback: string): string => {
  const e = err as {
    response?: { status?: number; data?: { message?: string; error?: { details?: Array<{ message?: string }> } } };
    message?: string;
  };
  const data = e?.response?.data;
  const detail = data?.error?.details?.[0]?.message;
  if (data?.message === 'Validation failed' && detail) return detail;
  if (data?.message) return data.message;
  if (e?.response === undefined && e?.message === 'Network Error') {
    return 'Can’t reach NimbusVault. Check your connection and try again.';
  }
  return fallback;
};

export const initials = (name?: string | null): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
};

export interface FileTypeMeta {
  icon: LucideIcon;
  label: string;
  /** Tailwind text color class for the icon. */
  tone: string;
  /** Tailwind background tint for icon tiles. */
  tint: string;
}

const extOf = (filename: string) => {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(idx + 1).toLowerCase() : '';
};

/** Maps a file to an icon, label, and color using its backend category, MIME type, and extension. */
export const getFileTypeMeta = (filename: string, mimeType = '', category = ''): FileTypeMeta => {
  const ext = extOf(filename);
  const mime = mimeType.toLowerCase();
  if (category === 'image' || mime.startsWith('image/')) return { icon: FileImage, label: 'Image', tone: 'text-[#c4a7ff]', tint: 'bg-[#c4a7ff]/10' };
  if (category === 'video' || mime.startsWith('video/')) return { icon: FileVideo, label: 'Video', tone: 'text-[#ff8fb1]', tint: 'bg-[#ff8fb1]/10' };
  if (category === 'pdf' || mime === 'application/pdf') return { icon: FileText, label: 'PDF', tone: 'text-[#ff7b70]', tint: 'bg-[#ff7b70]/10' };
  if (mime.startsWith('audio/')) return { icon: FileAudio, label: 'Audio', tone: 'text-[#7ee0c0]', tint: 'bg-[#7ee0c0]/10' };
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || mime.includes('spreadsheet') || mime === 'text/csv') return { icon: FileSpreadsheet, label: 'Spreadsheet', tone: 'text-success', tint: 'bg-success/10' };
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext) || mime.includes('presentation')) return { icon: Presentation, label: 'Presentation', tone: 'text-warning', tint: 'bg-warning/10' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || mime.includes('zip') || mime.includes('compressed')) return { icon: FileArchive, label: 'Archive', tone: 'text-[#d6b98c]', tint: 'bg-[#d6b98c]/10' };
  if (['js', 'ts', 'tsx', 'json', 'html', 'css', 'py', 'java', 'go', 'rs', 'md', 'xml', 'yml', 'yaml'].includes(ext)) return { icon: FileCode, label: 'Code', tone: 'text-info', tint: 'bg-info/10' };
  if (category === 'document' || mime.startsWith('text/') || ['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return { icon: FileText, label: 'Document', tone: 'text-[#7cb6ff]', tint: 'bg-[#7cb6ff]/10' };
  return { icon: FileIcon, label: ext ? ext.toUpperCase() : 'File', tone: 'text-muted-foreground', tint: 'bg-surface-raised' };
};

export const FILE_CATEGORIES = [
  { value: '', label: 'All types' },
  { value: 'document', label: 'Documents' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'other', label: 'Other' },
] as const;
