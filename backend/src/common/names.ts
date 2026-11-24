import { z } from 'zod';

/**
 * File and folder names are display names only: they never become storage keys or filesystem
 * paths. They are still restricted so they are safe to show, log, and send in headers.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\\/]/;

export const nameSchema = (label: string) =>
  z
    .string()
    .transform((v) => v.normalize('NFC').trim())
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .max(255, `${label} too long`)
        .refine((v) => !FORBIDDEN.test(v), `${label} contains characters that are not allowed`)
        .refine((v) => v !== '.' && v !== '..', `${label} is not allowed`)
    );

/** Best-effort clean-up for names supplied by browsers with an upload. */
export function sanitizeFilename(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(new RegExp(FORBIDDEN.source, 'g'), '')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'untitled';
  if (cleaned.length <= 255) return cleaned;
  const { stem, ext } = splitExtension(cleaned);
  return `${stem.slice(0, 255 - ext.length)}${ext}`;
}

export function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > 20) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/** "report.pdf" → "report (2).pdf", keeping the result within 255 characters. */
export function numberedName(name: string, n: number): string {
  const { stem, ext } = splitExtension(name);
  const suffix = ` (${n})`;
  return `${stem.slice(0, 255 - ext.length - suffix.length)}${suffix}${ext}`;
}

/** The first of `name`, `name (1)`, `name (2)`, … that is not already taken. */
export function firstFreeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 1; ; n++) {
    const candidate = numberedName(name, n);
    if (!taken.has(candidate)) return candidate;
  }
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename. */
export function contentDisposition(type: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
