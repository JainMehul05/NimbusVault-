import { AppError } from '@common/errors';

export const intelligenceEnabled = () => process.env.INTELLIGENCE_ENABLED === 'true';
export async function intelligence<T = unknown>(path: string, body?: unknown, actor?: string, scope: string[] = []): Promise<T> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token || token.length < 32) throw AppError.serviceUnavailable('Private intelligence service is not configured', 'AI_PROVIDER_UNAVAILABLE');
  const response = await fetch(`http://127.0.0.1:8101${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Token': token, ...(actor ? { 'X-Actor-Id': actor, 'X-File-Scope': JSON.stringify(scope) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new AppError(response.status === 503 ? 'AWS or local AI unavailable; inspect the verification status' : 'Private adapter request failed', response.status, 'ADAPTER_ERROR');
  return response.json() as Promise<T>;
}
