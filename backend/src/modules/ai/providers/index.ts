import { config } from '@config/index';
import type { EmbeddingProvider, GenerationProvider } from './types';
import { LocalEmbeddingProvider, OpenAICompatibleEmbeddingProvider } from './embeddings';
import { AnthropicGenerationProvider, OpenAICompatibleGenerationProvider } from './generation';

export * from './types';

function buildEmbeddingProvider(): EmbeddingProvider | null {
  const c = config.ai.embedding;
  switch (c.provider) {
    case 'local':
      return new LocalEmbeddingProvider(c.model, c.dimensions, c.localCacheDir, c.allowRemoteModels);
    case 'openai':
      // An API key is required for the public OpenAI endpoint; local gateways may not need one.
      if (!c.apiKey && c.baseUrl.includes('api.openai.com')) return null;
      return new OpenAICompatibleEmbeddingProvider(c.model, c.dimensions, c.baseUrl, c.apiKey, config.ai.providerTimeoutMs);
    default:
      return null;
  }
}

function buildGenerationProvider(): GenerationProvider | null {
  const c = config.ai.generation;
  switch (c.provider) {
    case 'openai':
      if (!c.apiKey && c.baseUrl.includes('api.openai.com')) return null;
      return new OpenAICompatibleGenerationProvider(c.model, c.baseUrl, c.apiKey, config.ai.providerTimeoutMs);
    case 'anthropic':
      if (!c.apiKey) return null;
      return new AnthropicGenerationProvider(c.model, c.baseUrl, c.apiKey, config.ai.providerTimeoutMs);
    default:
      return null;
  }
}

let embeddingProvider: EmbeddingProvider | null | undefined;
let generationProvider: GenerationProvider | null | undefined;

/** The configured embedding provider, or null when AI search is not configured. */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (embeddingProvider === undefined) embeddingProvider = buildEmbeddingProvider();
  return embeddingProvider;
}

/** The configured generation provider, or null when summaries/Q&A are not configured. */
export function getGenerationProvider(): GenerationProvider | null {
  if (generationProvider === undefined) generationProvider = buildGenerationProvider();
  return generationProvider;
}

/**
 * Test-only hook to install deterministic doubles. Refuses to run outside NODE_ENV=test so a
 * fake provider can never serve real users.
 */
export function setProvidersForTesting(providers: {
  embedding?: EmbeddingProvider | null;
  generation?: GenerationProvider | null;
}): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setProvidersForTesting is only available when NODE_ENV=test');
  }
  if ('embedding' in providers) embeddingProvider = providers.embedding ?? null;
  if ('generation' in providers) generationProvider = providers.generation ?? null;
}

export function resetProvidersForTesting(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetProvidersForTesting is only available when NODE_ENV=test');
  }
  embeddingProvider = undefined;
  generationProvider = undefined;
}
