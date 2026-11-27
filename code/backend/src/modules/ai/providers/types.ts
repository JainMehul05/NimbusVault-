/** A model that turns text into fixed-length vectors. */
export interface EmbeddingProvider {
  /** e.g. 'local', 'openai' */
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  /**
   * Stable identifier stored with every vector (provider + model + dimensions). Search only
   * compares vectors carrying the currently configured id, so switching models never mixes
   * incompatible embeddings.
   */
  readonly modelId: string;
  /** True when document text leaves this server (third-party API). */
  readonly sendsDataExternally: boolean;
  embed(texts: string[]): Promise<number[][]>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerationRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
}

export interface GenerationResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** True when the model stopped because it hit maxTokens. */
  truncated: boolean;
}

/** A chat/completions model used for summaries and grounded answers. */
export interface GenerationProvider {
  readonly name: string;
  readonly model: string;
  readonly sendsDataExternally: boolean;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

/** Raised for provider failures. `retryable` drives job backoff. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
