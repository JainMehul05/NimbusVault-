import { AppError } from '@common/errors';

export const intelligenceEnabled = () => process.env.INTELLIGENCE_ENABLED === 'true';
export async function intelligence<T = unknown>(path: string, body?: unknown, actor?: string, scope: string[] = []): Promise<T> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token || token.length < 32) throw AppError.serviceUnavailable('Private intelligence service is not configured', 'AI_PROVIDER_UNAVAILABLE');
  let response: Response;
  try { response = await fetch(`http://127.0.0.1:8101${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Token': token, ...(actor ? { 'X-Actor-Id': actor, 'X-File-Scope': JSON.stringify(scope) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  }); } catch { throw AppError.serviceUnavailable('Private intelligence service is unavailable. Retry after startup or inspect local runtime logs.', 'AI_PROVIDER_UNAVAILABLE'); }
  if (!response.ok) {
    if(response.status===499) throw new AppError('Answer preparation interrupted',499,'AI_CANCELLED');
    if(response.status===409 && path==='/api/ai/ask') throw AppError.conflict('Another local answer is being prepared. Wait or stop it before starting another.','AI_BUSY');
    throw new AppError(response.status === 503 ? 'AWS or local AI unavailable; inspect the verification status' : 'Requested evidence or operation is unavailable', response.status, 'ADAPTER_ERROR');
  }
  return response.json() as Promise<T>;
}
