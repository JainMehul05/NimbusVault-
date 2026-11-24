import { AiProviderError, type GenerationProvider, type GenerationRequest, type GenerationResult } from './types';
import { isLocalUrl, postJson } from './http';

/** OpenAI-compatible /chat/completions (OpenAI gpt-4o-mini per ADR-012, or a local Ollama). */
export class OpenAICompatibleGenerationProvider implements GenerationProvider {
  readonly name = 'openai';
  readonly sendsDataExternally: boolean;

  constructor(
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number
  ) {
    this.sendsDataExternally = !isLocalUrl(baseUrl);
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const data = await postJson<{
      model?: string;
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>(
      `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        model: this.model,
        messages: [{ role: 'system', content: request.system }, ...request.messages],
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0,
      },
      this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      this.timeoutMs
    );
    const choice = data?.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== 'string') {
      throw new AiProviderError('Generation provider returned no text', true);
    }
    return {
      text,
      model: data.model || this.model,
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
      truncated: choice?.finish_reason === 'length',
    };
  }
}

/** Anthropic Messages API (Claude), the documented fallback provider. */
export class AnthropicGenerationProvider implements GenerationProvider {
  readonly name = 'anthropic';
  readonly sendsDataExternally: boolean;

  constructor(
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number
  ) {
    this.sendsDataExternally = !isLocalUrl(baseUrl);
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const data = await postJson<{
      model?: string;
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>(
      `${this.baseUrl.replace(/\/$/, '')}/v1/messages`,
      {
        model: this.model,
        system: request.system,
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0,
      },
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      this.timeoutMs
    );
    const text = (data?.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    if (!data?.content) {
      throw new AiProviderError('Generation provider returned no text', true);
    }
    return {
      text,
      model: data.model || this.model,
      usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
      truncated: data.stop_reason === 'max_tokens',
    };
  }
}
