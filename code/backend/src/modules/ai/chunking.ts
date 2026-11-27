import type { PageSpan } from './extraction';

export interface TextChunk {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
  pageStart: number | null;
  pageEnd: number | null;
  tokenEstimate: number;
}

export interface ChunkOptions {
  /** Target characters per chunk. */
  size: number;
  /** Characters shared between consecutive chunks. */
  overlap: number;
}

/** Rough token estimate (≈4 characters per token for English text). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const BREAKS = ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' '];

function pageAt(pages: PageSpan[] | null, offset: number): number | null {
  if (!pages || pages.length === 0) return null;
  let lo = 0;
  let hi = pages.length - 1;
  let found = pages[0].page;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].start <= offset) {
      found = pages[mid].page;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Deterministic, overlap-aware chunking. The same text and options always yield identical
 * chunks (important for idempotent re-indexing). Windows end at the strongest natural break
 * (paragraph > line > sentence > clause > word) found in the last 40% of the window; the next
 * window starts `overlap` characters earlier, aligned forward to a word boundary.
 */
export function chunkText(text: string, options: ChunkOptions, pages: PageSpan[] | null = null): TextChunk[] {
  const size = Math.max(200, options.size);
  const overlap = Math.min(Math.max(0, options.overlap), Math.floor(size / 2));
  const chunks: TextChunk[] = [];
  const len = text.length;
  let start = 0;

  while (start < len) {
    let end = Math.min(start + size, len);

    if (end < len) {
      const windowStart = start + Math.floor(size * 0.6);
      for (const brk of BREAKS) {
        const at = text.lastIndexOf(brk, end - 1);
        if (at >= windowStart) {
          end = at + brk.length;
          break;
        }
      }
    }

    const raw = text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const content = raw.trim();
    if (content) {
      const charStart = start + leading;
      const charEnd = charStart + content.length;
      chunks.push({
        index: chunks.length,
        content,
        charStart,
        charEnd,
        pageStart: pageAt(pages, charStart),
        pageEnd: pageAt(pages, Math.max(charStart, charEnd - 1)),
        tokenEstimate: estimateTokens(content),
      });
    }

    if (end >= len) break;

    let next = Math.max(end - overlap, start + 1);
    // Align to the start of a word so chunks don't begin mid-word.
    if (next > start + 1 && /\S/.test(text[next - 1] ?? '')) {
      const space = text.indexOf(' ', next);
      if (space !== -1 && space < end) next = space + 1;
    }
    start = next;
  }

  return chunks;
}
