import { AiProviderError } from './types';

/** True for loopback/private hosts (e.g. a local Ollama), where data does not leave the network. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host === 'host.docker.internal' ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

/**
 * POSTs JSON with a hard timeout. Maps transport/HTTP failures to AiProviderError, never
 * including request bodies (document text) or credentials in the error message.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    throw new AiProviderError(aborted ? `AI provider timed out after ${timeoutMs} ms` : 'AI provider unreachable', true);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // 429 and 5xx are transient; other 4xx (bad key, bad model, bad request) are not.
    const retryable = response.status === 429 || response.status >= 500;
    let detail = '';
    try {
      const data = (await response.json()) as { error?: { message?: string; type?: string } };
      detail = data?.error?.type || '';
    } catch {
      /* ignore */
    }
    throw new AiProviderError(`AI provider returned HTTP ${response.status}${detail ? ` (${detail})` : ''}`, retryable, response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new AiProviderError('AI provider returned an invalid response', true);
  }
}
