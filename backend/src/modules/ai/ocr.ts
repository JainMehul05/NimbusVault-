import path from 'path';
import type * as PdfParseModule from 'pdf-parse';
import type * as TesseractModule from 'tesseract.js';
import { createChildLogger } from '@common/logger';

const log = createChildLogger({ module: 'ai-ocr' });

export interface OcrOptions {
  enabled: boolean;
  maxPages: number;
  language: string;
  dataPath: string;
  pageTimeoutMs: number;
}

export interface OcrPage {
  page: number;
  text: string;
}

/* eslint-disable @typescript-eslint/no-var-requires */

/** Recognition data is read from disk only; nothing is ever downloaded at runtime. */
function languageData(options: OcrOptions): { langPath: string; gzip: boolean } {
  if (options.dataPath) return { langPath: path.resolve(options.dataPath), gzip: true };
  const bundled = require(`@tesseract.js-data/${options.language}`) as { langPath: string; gzip: boolean };
  return { langPath: bundled.langPath, gzip: bundled.gzip };
}

/**
 * Recognises text in a scanned PDF on this server: pages are rendered with PDF.js and read by
 * tesseract.js (WebAssembly). Images and text never leave the process. Bounded by page count
 * and a per-page timeout.
 */
export async function ocrPdf(data: Uint8Array, options: OcrOptions): Promise<{ pages: OcrPage[]; total: number }> {
  const { PDFParse } = require('pdf-parse') as typeof PdfParseModule;
  const { createWorker } = require('tesseract.js') as typeof TesseractModule;

  const { langPath, gzip } = languageData(options);
  const worker = await createWorker(options.language, 1, {
    langPath,
    gzip,
    cacheMethod: 'none',
    logger: () => {},
    errorHandler: (err: unknown) => log.warn({ err: String(err).slice(0, 200) }, 'OCR engine error'),
  });

  const parser = new PDFParse({ data, isEvalSupported: false, enableXfa: false, verbosity: 0 });
  const pages: OcrPage[] = [];
  let total = 0;
  try {
    const info = await parser.getInfo();
    total = info.total;
    for (let n = 1; n <= Math.min(total, options.maxPages); n++) {
      // One page at a time keeps memory flat whatever the document length.
      const shot = await parser.getScreenshot({ partial: [n], desiredWidth: 1700, imageDataUrl: false, imageBuffer: true });
      const image = shot.pages[0]?.data;
      if (!image) continue;
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        worker.recognize(Buffer.from(image)),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), options.pageTimeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (!result) {
        log.warn({ page: n }, 'OCR page timed out; stopping');
        break;
      }
      // Very low confidence is noise from pictures, not text.
      if (result.data.confidence >= 40 && result.data.text.trim()) pages.push({ page: n, text: result.data.text });
    }
  } finally {
    await worker.terminate().catch(() => {});
    await parser.destroy().catch(() => {});
  }
  return { pages, total };
}
