import type { PrismaClient } from '@prisma/client';
import prisma from '@database/prisma';
import { config } from '@config/index';
import { AppError, ErrorCodes } from '@common/errors';
import { createChildLogger } from '@common/logger';
import { AiProviderError, getGenerationProvider } from './providers';
import { Semaphore } from './concurrency';
import { buildSummaryPrompt, SECTION_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from './prompts';

const log = createChildLogger({ module: 'ai-summary' });

/** Shared by summaries and Q&A so total concurrent model calls stay bounded. */
export const generationSemaphore = new Semaphore(config.ai.generation.maxConcurrent, 20);

const SINGLE_PASS_CHARS = 12_000;
const SECTION_CHARS = 8_000;
const MAX_SECTIONS = 6;

export class SummaryService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  /**
   * Generates and stores a summary for the file's current index generation.
   * Long documents use bounded map-reduce: at most MAX_SECTIONS evenly spaced sections are
   * condensed and then combined (≤ 7 model calls). `summaryCoverage` records the fraction of the
   * extracted text that was read, so the UI can say when a summary is partial.
   */
  async generate(fileId: string, expectedGeneration?: number): Promise<void> {
    const provider = getGenerationProvider();
    if (!provider) {
      await this.prismaClient.documentIndex.updateMany({
        where: { fileId },
        data: { summaryStatus: 'UNAVAILABLE', summaryError: 'No text-generation provider is configured' },
      });
      throw AppError.serviceUnavailable('AI summaries are not configured on this server', ErrorCodes.AI_PROVIDER_UNAVAILABLE);
    }

    const index = await this.prismaClient.documentIndex.findUnique({
      where: { fileId },
      include: { file: { select: { filename: true, deletedAt: true, aiStatus: true } } },
    });
    if (!index || index.file.deletedAt || index.file.aiStatus !== 'INDEXED' || !index.textContent) {
      throw AppError.badRequest('The document must be indexed before it can be summarized', ErrorCodes.AI_NOT_INDEXED);
    }
    if (expectedGeneration !== undefined && index.generation !== expectedGeneration) return;

    const text = index.textContent;
    const filename = index.file.filename;
    const maxTokens = Math.min(config.ai.generation.maxOutputTokens, 450);

    try {
      let summary: string;
      let coverage = 1;
      let model = provider.model;

      if (text.length <= SINGLE_PASS_CHARS) {
        const out = await generationSemaphore.run(() =>
          provider.generate({ system: SUMMARY_SYSTEM_PROMPT, messages: [{ role: 'user', content: buildSummaryPrompt(filename, text) }], maxTokens })
        );
        summary = out.text.trim();
        model = out.model;
      } else {
        const sectionCount = Math.min(MAX_SECTIONS, Math.ceil(text.length / SECTION_CHARS));
        const stride = text.length / sectionCount;
        const sections: string[] = [];
        for (let i = 0; i < sectionCount; i++) {
          const start = Math.floor(i * stride);
          sections.push(text.slice(start, start + SECTION_CHARS));
        }
        coverage = Math.min(1, (sectionCount * SECTION_CHARS) / text.length);

        const notes: string[] = [];
        for (const [i, section] of sections.entries()) {
          const out = await generationSemaphore.run(() =>
            provider.generate({
              system: SECTION_SYSTEM_PROMPT,
              messages: [{ role: 'user', content: buildSummaryPrompt(`${filename} (section ${i + 1} of ${sectionCount})`, section) }],
              maxTokens: 220,
            })
          );
          notes.push(out.text.trim());
        }
        const combined = await generationSemaphore.run(() =>
          provider.generate({
            system: SUMMARY_SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: buildSummaryPrompt(
                  filename,
                  notes.map((n, i) => `Section ${i + 1} notes:\n${n}`).join('\n\n'),
                  'The document text above consists of notes taken from evenly spaced sections of a long document.'
                ),
              },
            ],
            maxTokens,
          })
        );
        summary = combined.text.trim();
        model = combined.model;
      }

      if (!summary) throw new AiProviderError('The model returned an empty summary', true);

      // Only store if the document was not re-indexed meanwhile.
      await this.prismaClient.documentIndex.updateMany({
        where: { fileId, generation: index.generation },
        data: {
          summary,
          summaryStatus: 'READY',
          summaryModel: `${provider.name}:${model}`,
          summaryCoverage: coverage,
          summaryError: null,
          summaryGeneratedAt: new Date(),
        },
      });
    } catch (err) {
      const message = err instanceof AiProviderError ? err.message : 'Summary generation failed';
      if (!(err instanceof AppError)) {
        await this.prismaClient.documentIndex.updateMany({
          where: { fileId, generation: index.generation },
          data: { summaryStatus: 'FAILED', summaryError: message.slice(0, 300) },
        });
      }
      log.warn({ fileId, message }, 'Summary generation failed');
      if (err instanceof AppError) throw err;
      throw AppError.serviceUnavailable(`The AI provider could not generate a summary: ${message}`, 'AI_PROVIDER_ERROR');
    }
  }
}

export const summaryService = new SummaryService();
