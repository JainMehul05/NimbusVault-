import { useState } from 'react'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { api } from '@services/api'
import { useRuntimeHost, runtimeHostLabel } from '@hooks/useRuntimeHost'

interface Snapshot {
  local_intelligence?: {embedding_loaded?:boolean;runtime_available?:boolean;model?:string}
  audit?: { checked_at?: string; services?: Record<string, {status?:string;observed_at?:string;state?:string;consumer_state?:string;log_retention_days?:number}> }
  guard?: {allowed?:boolean;plan?:string;credits_usd?:number;checked_at?:string;status?:string}
  native_rehearsal?: {history?:Array<{stage:string;at:string}>;restored_idle?:{rule:string;consumer:string};finished_at?:string}
  live_probe?: {observed_at?:string;api_signed_ok?:boolean;api_unsigned_status?:number;standard_parameters_read?:number;native_log_event_count?:number;lambda_invocation_datapoints?:Array<{Sum:number}>}
}
const capabilities:Record<string,{purpose:string;source:string}>={
  S3:{purpose:'Private authoritative original bytes, checksums and authenticated downloads',source:'intelligence/app/storage.py'},
  DynamoDB:{purpose:'Cloud file revisions and native processing-job state',source:'intelligence/app/cloud.py'},
  Lambda:{purpose:'Bounded validation, classification, workflow tasks and IAM API responses',source:'infrastructure/worker.py'},
  EventBridge:{purpose:'Native finalized-original events routed to the ingestion queue',source:'infrastructure/cloudvault-stack.json'},
  SQS:{purpose:'Bounded event delivery, retries and partial-batch dispatch',source:'infrastructure/worker.py'},
  'SQS DLQ':{purpose:'Isolation of failed messages; no automatic purge or replay',source:'infrastructure/cloudvault-stack.json'},
  'Step Functions':{purpose:'Cloud stages, Catch handling and awaiting-local-processing boundary',source:'infrastructure/cloudvault-stack.json'},
  CloudWatch:{purpose:'Timestamped native logs and service metric observations',source:'intelligence/app/internal.py'},
  'API Gateway':{purpose:'SigV4/IAM-protected operational metadata API',source:'intelligence/app/cloud.py'},
  'S3 Vectors':{purpose:'Optional fixed approved-fixture demonstration; normal retrieval stays local',source:'intelligence/app/internal.py'},
  'Parameter Store':{purpose:'Standard shared configuration and drift verification',source:'scripts/verify-aws-detail.py'},
  CloudFormation:{purpose:'Existing deployed resource relationships; no automatic deployment',source:'infrastructure/cloudvault-stack.json'},
}
export function CloudPage() {
  const [status, setStatus] = useState<Snapshot | null>(null)
  const [message, setMessage] = useState('Detailed infrastructure diagnostics require a designated administrator.')
  const [busy, setBusy] = useState(false)
  const host = useRuntimeHost()
  async function refresh() {
    setBusy(true)
    try { const response=await api.get('/ai/cloud'); setStatus(response.data.data); setMessage('Timestamped evidence; availability is not continuously monitored.') }
    catch { setMessage('Diagnostics unavailable or this account is not an administrator. No cloud operation was started.') }
    finally { setBusy(false) }
  }
  async function vectorDemo() {
    setBusy(true)
    try { const r=await api.post('/ai/cloud/vector-demo'); setMessage(r.data.data.matched ? `${r.data.data.provider}: approved fixture matched; cosine similarity ${r.data.data.cosine_similarity.toFixed(3)}. One AWS query; normal retrieval remains local.` : 'The AWS query completed without a verified approved-fixture match. Normal retrieval remains local.') }
    catch { setMessage('The approved cloud vector demonstration is unavailable. Local retrieval remains available.') }
    finally { setBusy(false) }
  }
  return <AppShell title="Cloud Infrastructure" description="Private AWS storage and serverless workflows, with local search and generation.">
    <div className="grid gap-4 md:grid-cols-2">
      <section className="border border-border bg-surface p-5"><h2 className="font-semibold">{runtimeHostLabel(host)}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">NimbusVault handles accounts, permissions and folders in PostgreSQL. MiniLM creates 384-dimensional embeddings; SQLite holds passages and vectors. Qwen2.5 3B generates grounded answers through Ollama. Normal search makes no S3 Vectors request.</p></section>
      <section className="border border-border bg-surface p-5"><h2 className="font-semibold">In AWS · Sydney</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Original bytes use private S3. EventBridge → SQS → Lambda → Step Functions records workflow state in DynamoDB. CloudWatch, IAM API Gateway and Parameter Store support diagnostics. Existing physical resources retain their CloudVault names.</p></section>
    </div>
    <section className="mt-5 border border-border bg-surface p-5"><h2 className="font-semibold">Verification and cost controls</h2><p className="my-3 text-sm leading-6 text-muted-foreground">AWS operations fail closed unless the active Free plan and credit reserve can be verified. Event processing stays paused outside a bounded rehearsal. This local guard is not an AWS billing cap. Cloud vector demonstration uses only a configured, non-sensitive canary and grants no legacy document access.</p><div className="flex flex-wrap gap-2"><Button variant="secondary" loading={busy} onClick={refresh}>Refresh administrator snapshot</Button>{status && <Button variant="secondary" disabled={busy} onClick={vectorDemo}>Run one AWS vector fixture query</Button>}</div><p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p></section>
    {status && <>
      <section className="mt-5 border border-border p-4 text-sm"><h2 className="font-semibold">Current local intelligence</h2><p className="mt-2 text-muted-foreground">MiniLM: {status.local_intelligence?.embedding_loaded?'loaded':'loads on first query'} · Qwen: {status.local_intelligence?.runtime_available?'installed runtime available':'unavailable; cited fallback remains available'}</p><p className="mt-2 text-xs text-subtle">Financial guard checked: {status.guard?.checked_at ?? 'unverified'} · CloudWatch snapshot: {status.live_probe?.observed_at ?? 'unverified'} · Native rehearsal finished: {status.native_rehearsal?.finished_at ?? 'unverified'}. Historical activity is not continuous health monitoring.</p></section>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><section className="border border-border p-4"><h3 className="text-xs text-muted-foreground">Financial guard</h3><p className="mt-2 font-semibold">{status.guard?.allowed ? `${status.guard.plan} · active` : 'Paused / unverified'}</p><p className="mt-1 text-xs text-subtle">{status.guard?.credits_usd != null ? `US$${status.guard.credits_usd.toFixed(2)} eligible credits` : 'Balance unavailable'}</p></section><section className="border border-border p-4"><h3 className="text-xs text-muted-foreground">Event routing · last rehearsal</h3><p className="mt-2 font-semibold">{status.native_rehearsal?.restored_idle?.rule ?? 'Unknown'}</p><p className="mt-1 text-xs text-subtle">Consumer: {status.native_rehearsal?.restored_idle?.consumer ?? 'Unknown'}</p></section><section className="border border-border p-4"><h3 className="text-xs text-muted-foreground">CloudWatch · observed logs</h3><p className="mt-2 font-semibold">{status.live_probe?.native_log_event_count ?? 'Unavailable'}</p><p className="mt-1 text-xs text-subtle">{status.live_probe?.lambda_invocation_datapoints?.length ? `${status.live_probe.lambda_invocation_datapoints.reduce((s,p)=>s+p.Sum,0)} Lambda invocations in observed window` : 'Metric datapoints not yet available'}</p></section></div>
      <section className="mt-5 overflow-x-auto border border-border"><table className="w-full text-left text-sm"><caption className="p-4 text-left text-xs text-muted-foreground">Read-only audit · {status.audit?.checked_at ?? 'No audit timestamp'}</caption><thead><tr className="border-b border-border"><th className="p-3">Capability</th><th className="p-3">Observed status</th><th className="p-3">Detail</th></tr></thead><tbody>{Object.entries(status.audit?.services ?? {}).map(([name,entry])=><tr key={name} className="border-b border-border last:border-0"><td className="p-3 font-medium">{name}<p className="mt-1 max-w-sm text-xs font-normal text-muted-foreground">{capabilities[name]?.purpose}</p><code className="mt-1 block break-all text-2xs font-normal text-subtle">{capabilities[name]?.source}</code></td><td className="p-3 text-muted-foreground">{entry.status?.replace(/_/g,' ') ?? 'Unknown'}<time className="mt-1 block text-2xs text-subtle">{entry.observed_at ?? 'No verification time'}</time></td><td className="p-3 text-muted-foreground">{entry.consumer_state ? `Consumer ${entry.consumer_state}` : entry.state ?? (entry.log_retention_days ? `${entry.log_retention_days}-day log retention` : 'See verified snapshot')}</td></tr>)}</tbody></table></section>
      <section className="mt-5 border border-border p-5"><h2 className="font-semibold">Native upload workflow · recorded evidence</h2><ol className="mt-3 space-y-3">{status.native_rehearsal?.history?.map((stage,i)=><li key={`${stage.stage}-${i}`} className="flex flex-wrap justify-between gap-2 text-sm"><span>{stage.stage.replace(/_/g,' ')}</span><time className="text-xs text-muted-foreground">{stage.at}</time></li>)}</ol><p className="mt-3 text-xs text-subtle">The native workflow stops while awaiting local embeddings. The recorded final application reconciliation completed local metadata separately.</p></section>
    </>}
  </AppShell>
}
