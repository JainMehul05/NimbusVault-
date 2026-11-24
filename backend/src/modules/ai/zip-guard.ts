import { inflateRawSync } from 'zlib';

/**
 * Upper bound on what an archive expands to, measured by actually inflating it under a limit.
 * Sizes in ZIP headers are attacker-controlled, so they are never trusted. Returns false when
 * the archive exceeds `maxBytes` or is malformed.
 */
export function zipWithinLimit(buffer: Buffer, maxBytes: number, maxEntries = 5000): boolean {
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const LOCAL = 0x04034b50;

  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return false;

  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  if (count > maxEntries) return false;

  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL) return false;
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const local = buffer.readUInt32LE(at + 42);
    at += 46 + buffer.readUInt16LE(at + 28) + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);

    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL) return false;
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + compressed);
    if (data.length !== compressed) return false;

    if (method === 0) {
      total += data.length;
    } else if (method === 8) {
      const remaining = maxBytes - total;
      if (remaining <= 0) return false;
      try {
        total += inflateRawSync(data, { maxOutputLength: remaining }).length;
      } catch {
        return false; // too large, or corrupt
      }
    } else {
      return false;
    }
    if (total > maxBytes) return false;
  }
  return true;
}
