/**
 * Content checks for uploads. The declared MIME type comes from the client, so the first bytes
 * are inspected to refuse content that would be dangerous under a false label. Genuine format
 * problems (a truncated PDF, say) are left to the AI extractor, which reports them precisely.
 */
const starts = (b: Buffer, sig: number[] | string, offset = 0) => {
  const bytes = typeof sig === 'string' ? Buffer.from(sig, 'latin1') : Buffer.from(sig);
  return b.length >= offset + bytes.length && b.subarray(offset, offset + bytes.length).equals(bytes);
};

/** Native executables and scripts are never accepted, whatever they claim to be. */
export function isExecutable(head: Buffer): boolean {
  return (
    starts(head, 'MZ') || // Windows PE
    starts(head, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    starts(head, [0xfe, 0xed, 0xfa, 0xce]) || // Mach-O
    starts(head, [0xfe, 0xed, 0xfa, 0xcf]) ||
    starts(head, [0xce, 0xfa, 0xed, 0xfe]) ||
    starts(head, [0xcf, 0xfa, 0xed, 0xfe]) ||
    starts(head, '#!/')
  );
}

/** Active web content (which could run script if ever rendered from our origin). */
export function looksLikeHtml(head: Buffer): boolean {
  const text = head.subarray(0, 1024).toString('latin1').replace(/^\u00ef\u00bb\u00bf/, '').trimStart().toLowerCase();
  return /^(<!doctype html|<html|<head|<body|<script|<iframe)/.test(text);
}

const BINARY_TYPES = /^(application\/(pdf|msword|rtf|vnd\.)|image\/(?!svg)|video\/)/;

/** Why this content must be refused, or null when it is acceptable for `mimeType`. */
export function contentProblem(head: Buffer, mimeType: string): string | null {
  // Markdown and plain text may legitimately begin with anything printable, including "MZ".
  // NUL bytes are allowed too: UTF-16 text is full of them. Text is only ever served as text.
  if (mimeType.startsWith('text/')) {
    return starts(head, '#!/') || starts(head, [0x7f, 0x45, 0x4c, 0x46]) ? 'Executable files are not allowed' : null;
  }
  if (isExecutable(head)) return 'Executable files are not allowed';
  if (BINARY_TYPES.test(mimeType) && looksLikeHtml(head)) return 'File content does not match its type';
  return null;
}

/** Types a browser may display in place. SVG and HTML can carry script, so they never qualify. */
export const isInlineSafe = (mimeType: string): boolean =>
  /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime)|application\/pdf|text\/plain)$/.test(mimeType);
