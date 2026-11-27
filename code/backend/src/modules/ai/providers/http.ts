import { AiProviderError } from './types';

/** True for loopback/private hosts (e.g. a local Ollama), where data does not leave the network. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host.endsWith('.local') ||
      host === 'host.docker.internal' ||
      // Whole IPv4 literals only: "10.evil.com" is a public hostname.
      /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(host)
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
  // The timeout covers the whole exchange, including a body that trickles in forever.
  const signal = AbortSignal.timeout(timeoutMs);
  const transportError = (err: unknown) =>
    new AiProviderError(
      signal.aborted || (err as Error)?.name === 'TimeoutError' ? `AI provider timed out after ${timeoutMs} ms` : 'AI provider unreachable',
      true
    );

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      // Never follow a redirect with document text and credentials attached.
      redirect: 'error',
      signal,
    });
  } catch (err) {
    throw transportError(err);
  }

  if (!response.ok) {
    // 408, 429 and 5xx are transient; other 4xx (bad key, bad model, bad request) are not.
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    let detail = '';
    try {
      const data = (await response.json()) as { error?: { type?: unknown } };
      // Only a short machine code is kept; free-form messages could echo document text.
      if (typeof data?.error?.type === 'string' && /^[\w.-]{1,64}$/.test(data.error.type)) detail = data.error.type;
    } catch {
      /* ignore */
    }
    throw new AiProviderError(`AI provider returned HTTP ${response.status}${detail ? ` (${detail})` : ''}`, retryable, response.status);
  }

  try {
    return (await response.json()) as T;
  } catch (err) {
    if (signal.aborted) throw transportError(err);
    throw new AiProviderError('AI provider returned an invalid response', true);
  }
}
