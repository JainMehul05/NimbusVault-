import type * as PdfParseModule from 'pdf-parse';
import { ocrPdf, type OcrOptions } from './ocr';
import { zipWithinLimit } from './zip-guard';

/**
 * Server-side text extraction for PDF, DOCX, Markdown and plain text.
 *
 * Safety properties:
 *  - Content is sniffed: the declared MIME type must match the file's magic bytes.
 *  - PDFs are parsed with PDF.js text extraction only (no rendering, no scripting, eval disabled);
 *    embedded JavaScript and forms are never executed.
 *  - DOCX is read with mammoth (document XML only); macros are never run, and macro-enabled
 *    formats (.docm) are not accepted.
 *  - DOCX archives are measured while inflating under a hard cap (zip-bomb protection).
 *  - Page and character limits bound CPU and memory; output is normalized and capped.
 *  - Image-only PDFs are read with local OCR when enabled, and otherwise reported as
 *    OCR_REQUIRED instead of "succeeding" with no text.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const SUPPORTED_AI_MIME_TYPES = ['application/pdf', DOCX_MIME, 'text/plain', 'text/markdown'];

export type ExtractionErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'FILE_TOO_LARGE'
  | 'CONTENT_MISMATCH'
  | 'ENCRYPTED'
  | 'CORRUPTED'
  | 'OCR_REQUIRED'
  | 'EMPTY'
  | 'TOO_MANY_PAGES';

/** A permanent, non-retryable problem with the document itself. */
export class ExtractionError extends Error {
  constructor(
    public readonly code: ExtractionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ExtractionError';
  }

  /** Whether the file is simply not processable (vs. a failure worth a user's attention). */
  get unsupported(): boolean {
    return ['UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'OCR_REQUIRED', 'TOO_MANY_PAGES', 'EMPTY'].includes(this.code);
  }
}

export interface PageSpan {
  page: number;
  start: number;
  end: number;
}

export interface ExtractionResult {
  text: string;
  pages: PageSpan[] | null;
  pageCount: number | null;
  extractor: string;
  truncated: boolean;
}

export interface ExtractionLimits {
  maxBytes: number;
  maxChars: number;
  maxPdfPages: number;
  maxUncompressedBytes?: number;
  ocr?: OcrOptions;
}

export function isAiSupportedMimeType(mimeType: string): boolean {
  return SUPPORTED_AI_MIME_TYPES.includes(mimeType);
}

/** Collapses whitespace noise and strips control characters while keeping paragraph breaks. */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const startsWith = (buf: Buffer, sig: number[]) => sig.every((b, i) => buf[i] === b);

function decodeUtf8Text(buffer: Buffer): string {
  // Binary content is not text, whatever the declared type says.
  const probe = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (probe.includes(0)) {
    throw new ExtractionError('CONTENT_MISMATCH', 'File content is binary, not text');
  }
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
  } catch {
    throw new ExtractionError('CORRUPTED', 'Text file is not valid UTF-8');
  }
}

function finalize(raw: string, limits: ExtractionLimits, extractor: string, pages: PageSpan[] | null, pageCount: number | null): ExtractionResult {
  const normalized = normalizeText(raw);
  const truncated = normalized.length > limits.maxChars;
  const text = truncated ? normalized.slice(0, limits.maxChars) : normalized;
  const clippedPages = pages
    ? pages.filter((p) => p.start < text.length).map((p) => ({ ...p, end: Math.min(p.end, text.length) }))
    : null;
  return { text, pages: clippedPages, pageCount, extractor, truncated };
}

async function extractPdf(buffer: Buffer, limits: ExtractionLimits): Promise<ExtractionResult> {
  if (!startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw new ExtractionError('CONTENT_MISMATCH', 'File is not a valid PDF');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PDFParse } = require('pdf-parse') as typeof PdfParseModule;
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    let result;
    try {
      result = await parser.getText({ first: limits.maxPdfPages, pageJoiner: '' });
    } catch (err) {
      const name = (err as Error)?.name ?? '';
      if (name === 'PasswordException') {
        throw new ExtractionError('ENCRYPTED', 'PDF is password-protected');
      }
      throw new ExtractionError('CORRUPTED', 'PDF could not be parsed');
    }

    // Build text page by page so chunks can cite page numbers.
    let raw = '';
    const pages: PageSpan[] = [];
    for (const page of result.pages) {
      const pageText = normalizeText(page.text ?? '');
      if (!pageText) continue;
      if (raw) raw += '\n\n';
      const start = raw.length;
      raw += pageText;
      pages.push({ page: page.num, start, end: raw.length });
    }

    const total = result.total ?? result.pages.length;
    const meaningful = raw.replace(/\s+/g, '').length;
    if (meaningful < 20 || (total > 0 && meaningful / total < 15)) {
      if (!limits.ocr?.enabled) {
        throw new ExtractionError(
          'OCR_REQUIRED',
          'No extractable text found — this PDF appears to be scanned or image-only. OCR is not enabled.'
        );
      }
      return await extractScannedPdf(buffer, limits, limits.ocr, total);
    }

    // Already normalized per page; finalize clamps length.
    const out = finalize(raw, limits, 'pdf-parse/pdfjs', pages, total);
    if (total > limits.maxPdfPages) out.truncated = true;
    return out;
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractScannedPdf(
  buffer: Buffer,
  limits: ExtractionLimits,
  options: OcrOptions,
  total: number
): Promise<ExtractionResult> {
  // PDF.js takes ownership of (detaches) its input, so each parser needs its own copy.
  const { pages: recognised } = await ocrPdf(new Uint8Array(buffer), options);
  let raw = '';
  const pages: PageSpan[] = [];
  for (const page of recognised) {
    const text = normalizeText(page.text);
    if (!text) continue;
    if (raw) raw += '\n\n';
    const start = raw.length;
    raw += text;
    pages.push({ page: page.page, start, end: raw.length });
  }
  if (raw.replace(/\s+/g, '').length < 20) {
    throw new ExtractionError('OCR_REQUIRED', 'This PDF is scanned and no readable text was recognised in it.');
  }
  const out = finalize(raw, limits, 'tesseract-ocr', pages, total);
  if (total > options.maxPages) out.truncated = true;
  return out;
}

async function extractDocx(buffer: Buffer, limits: ExtractionLimits): Promise<ExtractionResult> {
  if (!startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    throw new ExtractionError('CONTENT_MISMATCH', 'File is not a valid DOCX document');
  }
  if (!zipWithinLimit(buffer, limits.maxUncompressedBytes ?? 150 * 1024 * 1024)) {
    throw new ExtractionError('CORRUPTED', 'DOCX document is damaged or expands beyond the processing limit');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mammoth = require('mammoth') as { extractRawText(input: { buffer: Buffer }): Promise<{ value: string }> };
  let value: string;
  try {
    ({ value } = await mammoth.extractRawText({ buffer }));
  } catch (err) {
    const msg = String((err as Error)?.message ?? '');
    if (/encrypt|password/i.test(msg)) throw new ExtractionError('ENCRYPTED', 'Document is password-protected');
    throw new ExtractionError('CORRUPTED', 'DOCX document could not be read');
  }
  return finalize(value, limits, 'mammoth', null, null);
}

export async function extractDocument(
  buffer: Buffer,
  mimeType: string,
  limits: ExtractionLimits
): Promise<ExtractionResult> {
  if (!isAiSupportedMimeType(mimeType)) {
    throw new ExtractionError('UNSUPPORTED_TYPE', `AI indexing does not support ${mimeType}`);
  }
  if (buffer.length > limits.maxBytes) {
    throw new ExtractionError('FILE_TOO_LARGE', `File exceeds the ${Math.round(limits.maxBytes / 1048576)} MB AI processing limit`);
  }

  let result: ExtractionResult;
  if (mimeType === 'application/pdf') {
    result = await extractPdf(buffer, limits);
  } else if (mimeType === DOCX_MIME) {
    result = await extractDocx(buffer, limits);
  } else {
    result = finalize(decodeUtf8Text(buffer), limits, mimeType === 'text/markdown' ? 'markdown' : 'text', null, null);
  }

  if (!result.text) {
    throw new ExtractionError('EMPTY', 'The document contains no text');
  }
  return result;
}
