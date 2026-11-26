import { useState } from 'react'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { api } from '@services/api'

export function CloudPage() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('Detailed infrastructure diagnostics require a designated administrator.')
  const [busy, setBusy] = useState(false)
  async function refresh() {
    setBusy(true)
    try {
      const response = await api.get('/ai/cloud')
      setStatus(response.data.data)
      setMessage('Observed snapshot; availability is not continuously monitored.')
    } catch { setMessage('Diagnostics unavailable or this account is not an administrator. No cloud operation was started.') }
    finally { setBusy(false) }
  }
  return <AppShell title="Cloud Infrastructure" description="Private AWS storage and serverless workflows, with local search and generation.">
    <div className="grid gap-4 md:grid-cols-2">
      <section className="border border-border bg-surface p-5"><h2 className="font-semibold">On this laptop</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">NimbusVault handles accounts, permissions and folders in local PostgreSQL. MiniLM creates 384-dimensional embeddings; SQLite holds passages and vectors. Qwen2.5 3B generates grounded answers through local Ollama. Normal search makes no S3 Vectors request.</p></section>
      <section className="border border-border bg-surface p-5"><h2 className="font-semibold">In AWS · Sydney</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Original bytes use private S3. The existing EventBridge → SQS → Lambda → Step Functions path records cloud workflow state in DynamoDB. CloudWatch, IAM API Gateway and Parameter Store support diagnostics. Existing physical resources retain their CloudVault names.</p></section>
    </div>
    <section className="mt-5 border border-border bg-surface p-5"><h2 className="font-semibold">Verification and cost controls</h2><p className="my-3 text-sm leading-6 text-muted-foreground">AWS operations fail closed unless the active Free plan and credit reserve can be verified. Event processing stays paused outside a bounded rehearsal. This local guard is not an AWS billing cap. Optional cloud vector retrieval is unavailable to ordinary accounts until a safe authorized fixture scope is configured.</p><Button variant="secondary" loading={busy} onClick={refresh}>Refresh administrator snapshot</Button><p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>{status && <pre className="mt-4 max-w-full overflow-auto whitespace-pre-wrap break-words border border-border p-4 text-xs">{JSON.stringify(status, null, 2)}</pre>}</section>
  </AppShell>
}
