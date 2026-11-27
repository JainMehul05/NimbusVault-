import { useEffect, useState } from 'react'
import { aiApi, type AiCapabilities } from '@services/ai'

export type AiMode = 'auto' | 'local'

/**
 * Shown only when the server has the external Groq provider configured. Makes the privacy
 * boundary explicit: fast cloud AI sends the question and relevant excerpts to Groq, and only for
 * documents whose owners allowed it. Private local AI is offered only when it is operational.
 */
export function AiModePanel({ caps, mode, onMode }: { caps: AiCapabilities | null; mode: AiMode; onMode: (m: AiMode) => void }) {
  const providers = caps?.providers
  const [consent, setConsent] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!providers) return
    let active = true
    aiApi.preferences().then((p) => { if (active) setConsent(p.externalAiConsent) }).catch(() => { if (active) setConsent(false) })
    return () => { active = false }
  }, [providers])
  if (!providers) return null
  const toggle = async (value: boolean) => {
    setBusy(true)
    try { setConsent((await aiApi.setPreferences(value)).externalAiConsent) } finally { setBusy(false) }
  }
  const option = (value: AiMode, label: string, detail: string, enabled: boolean) => (
    <button
      type="button"
      aria-pressed={mode === value}
      disabled={!enabled}
      onClick={() => onMode(value)}
      className={`flex-1 border px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${mode === value ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/50'}`}
    >
      <span className="block font-semibold text-foreground">{label}</span>
      <span className="block">{detail}</span>
    </button>
  )
  return (
    <div className="mb-3 border border-border bg-surface p-3" aria-label="AI mode">
      <div className="flex flex-col gap-2 sm:flex-row">
        {option('auto', 'Fast Cloud AI — Groq', providers.groq.available ? `External · ${caps?.generation.model ?? 'Groq'}` : (providers.groq.reason ?? 'Unavailable'), true)}
        {option('local', 'Private Local AI — Qwen', providers.local.available ? 'Runs inside NimbusVault' : 'Not running on this server', providers.local.available)}
      </div>
      {mode === 'auto' && (
        <p className="mt-2 text-2xs text-muted-foreground">
          {consent
            ? 'Fast cloud AI sends your question and the relevant excerpts of documents whose owners allowed it to Groq. Search and indexing stay inside NimbusVault. '
            : 'Fast cloud AI is off for your account: answers show source excerpts only (or use private local AI). '}
          <button type="button" disabled={busy || consent === null} onClick={() => toggle(!consent)} className="font-semibold text-primary underline-offset-2 hover:underline">
            {consent ? 'Turn off fast cloud AI' : 'Allow fast cloud AI for my questions and documents'}
          </button>
        </p>
      )}
    </div>
  )
}
