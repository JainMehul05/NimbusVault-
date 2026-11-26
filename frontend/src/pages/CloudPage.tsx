import { useState } from 'react'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { api } from '@services/api'

interface Snapshot {
  audit?: { checked_at?: string; services?: Record<string, {status?:string;observed_at?:string;state?:string;consumer_state?:string;log_retention_days?:number}> }
  guard?: {allowed?:boolean;plan?:string;credits_usd?:number;checked_at?:string;status?:string}
  native_rehearsal?: {history?:Array<{stage:string;at:string}>;restored_idle?:{rule:string;consumer:string};finished_at?:string}
  live_probe?: {observed_at?:string;api_signed_ok?:boolean;api_unsigned_status?:number;standard_parameters_read?:number;native_log_event_count?:number;lambda_invocation_datapoints?:Array<{Sum:number}>}
}
export function CloudPage() {
  const [status, setStatus] = useState<Snapshot | null>(null)
  const [message, setMessage] = useState('Detailed infrastructure diagnostics require a designated administrator.')
  const [busy, setBusy] = useState(false)
  async function refresh() {
    setBusy(true)
    try { const response=await api.get('/ai/cloud'); setStatus(response.data.data); setMessage('Timestamped evidence; availability is not continuously monitored.') }
    catch { setMessage('Diagnostics unavailable or this account is not an administrator. No cloud operation was started.') }
    finally { setBusy(false) }
  }
  async function vectorDemo() {
    setBusy(true)
    try { const r=await api.post('/ai/cloud/vector-demo'); setMessage(`${r.data.data.provider}: approved fixture matched; cosine similarity ${r.data.data.cosine_similarity.toFixed(3)}. One AWS query; normal retrieval remains local.`) }
    catch { setMessage('The approved cloud vector demonstration is unavailable. Local retrieval remains available.') }
    finally { setBusy(false) }
  }
  return <AppShell title="Cloud Infrastructure" description="Private AWS storage and serverless workflows, with local search and generation.">
    <div className="grid gap-4 md:grid-cols-2">
      <section className="border border-border bg-surface p-5"><h2 className="font-semibold">On this laptop</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">NimbusVault handles accounts, permissions and folders in PostgreSQL. MiniLM creates 384-dimensional embeddings; SQLite holds passages and vectors. Qwen2.5 3B generates grounded answers through Ollama. Normal search makes no S3 Vectors request.</p></section>
      <section className="border border-border bg-surface p-5"><h2 className="font-semibold">In AWS · Sydney</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Original bytes use private S3. EventBridge → SQS → Lambda → Step Functions records workflow state in DynamoDB. CloudWatch, IAM API Gateway and Parameter Store support diagnostics. Existing physical resources retain their CloudVault names.</p></section>
    </div>
    <section className="mt-5 border border-border bg-surface p-5"><h2 className="font-semibold">Verification and cost controls</h2><p className="my-3 text-sm leading-6 text-muted-foreground">AWS operations fail closed unless the active Free plan and credit reserve can be verified. Event processing stays paused outside a bounded rehearsal. This local guard is not an AWS billing cap. Cloud vector demonstration uses only a configured, non-sensitive canary and grants no legacy document access.</p><div className="flex flex-wrap gap-2"><Button variant="secondary" loading={busy} onClick={refresh}>Refresh administrator snapshot</Button>{status && <Button variant="secondary" disabled={busy} onClick={vectorDemo}>Run one AWS vector fixture query</Button>}</div><p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p></section>
    {status && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><section className="border border-border p-4"><h3 className="text-xs text-muted-foreground">Financial guard</h3><p className="mt-2 font-semibold">{status.guard?.allowed ? `${status.guard.plan} · active` : 'Paused / unverified'}</p><p className="mt-1 text-xs text-subtle">{status.guard?.credits_usd != null ? `US$${status.guard.credits_usd.toFixed(2)} eligible credits` : 'Balance unavailable'}</p></section><section className="border border-border p-4"><h3 className="text-xs text-muted-foreground">Event routing · last rehearsal</h3><p className="mt-2 font-semibold">{status.native_rehearsal?.restored_idle?.rule ?? 'Unknown'}</p><p className="mt-1 text-xs text-subtle">Consumer: {status.native_rehearsal?.restored_idle?.consumer ?? 'Unknown'}</p></section><section className="border border-border p-4"><h3 className="text-xs text-muted-foreground">CloudWatch · observed logs</h3><p className="mt-2 font-semibold">{status.live_probe?.native_log_event_count ?? 'Unavailable'}</p><p className="mt-1 text-xs text-subtle">{status.live_probe?.lambda_invocation_datapoints?.length ? `${status.live_probe.lambda_invocation_datapoints.reduce((s,p)=>s+p.Sum,0)} Lambda invocations in observed window` : 'Metric datapoints not yet available'}</p></section></div>
      <section className="mt-5 overflow-x-auto border border-border"><table className="w-full text-left text-sm"><caption className="p-4 text-left text-xs text-muted-foreground">Read-only audit · {status.audit?.checked_at ?? 'No audit timestamp'}</caption><thead><tr className="border-b border-border"><th className="p-3">Capability</th><th className="p-3">Observed status</th><th className="p-3">Detail</th></tr></thead><tbody>{Object.entries(status.audit?.services ?? {}).map(([name,entry])=><tr key={name} className="border-b border-border last:border-0"><td className="p-3 font-medium">{name}</td><td className="p-3 text-muted-foreground">{entry.status?.replace(/_/g,' ') ?? 'Unknown'}</td><td className="p-3 text-muted-foreground">{entry.consumer_state ? `Consumer ${entry.consumer_state}` : entry.state ?? (entry.log_retention_days ? `${entry.log_retention_days}-day log retention` : 'See verified snapshot')}</td></tr>)}</tbody></table></section>
      <section className="mt-5 border border-border p-5"><h2 className="font-semibold">Native upload workflow · recorded evidence</h2><ol className="mt-3 space-y-3">{status.native_rehearsal?.history?.map((stage,i)=><li key={`${stage.stage}-${i}`} className="flex flex-wrap justify-between gap-2 text-sm"><span>{stage.stage.replace(/_/g,' ')}</span><time className="text-xs text-muted-foreground">{stage.at}</time></li>)}</ol><p className="mt-3 text-xs text-subtle">The native workflow stops while awaiting local embeddings. The recorded final application reconciliation completed local metadata separately.</p></section>
    </>}
  </AppShell>
}
