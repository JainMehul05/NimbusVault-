import { config } from '@config/index';
import { getEmbeddingProvider, getGenerationProvider } from './providers';
import { SUPPORTED_AI_MIME_TYPES } from './extraction';

let workerRunning = false;
export const setWorkerRunning = (running: boolean) => {
  workerRunning = running;
};

/**
 * Public description of the AI subsystem. Never includes credentials or endpoint URLs.
 * `privacy.sendsDocumentsToThirdParty` drives the disclosure shown in the UI.
 */
export function getAiStatus() {
  const embedding = getEmbeddingProvider();
  const generation = getGenerationProvider();
  const external = [embedding, generation].filter((p) => p?.sendsDataExternally).map((p) => p!.name);

  return {
    enabled: !!embedding,
    embedding: {
      configured: !!embedding,
      provider: embedding?.name ?? null,
      model: embedding?.model ?? null,
      dimensions: embedding?.dimensions ?? null,
      requestedProvider: config.ai.embedding.provider,
    },
    generation: {
      configured: !!generation,
      provider: generation?.name ?? null,
      model: generation?.model ?? null,
      requestedProvider: config.ai.generation.provider,
    },
    features: {
      indexing: !!embedding,
      semanticSearch: !!embedding,
      summaries: !!embedding && !!generation,
      questionAnswering: !!embedding && !!generation,
      ocr: false,
    },
    worker: { running: workerRunning, concurrency: config.ai.worker.concurrency },
    limits: {
      maxFileBytes: config.ai.limits.maxFileBytes,
      maxPdfPages: config.ai.limits.maxPdfPages,
      maxExtractedChars: config.ai.limits.maxExtractedChars,
      queriesPerWindow: config.ai.limits.queriesPerWindow,
      queryWindowMs: config.ai.limits.queryWindowMs,
    },
    supportedMimeTypes: SUPPORTED_AI_MIME_TYPES,
    privacy: {
      sendsDocumentsToThirdParty: external.length > 0,
      externalProviders: [...new Set(external)],
    },
  };
}

export type AiStatus = ReturnType<typeof getAiStatus>;
