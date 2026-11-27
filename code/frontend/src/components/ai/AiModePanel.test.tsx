import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { aiApi, type AiCapabilities } from '@services/ai'
import { AiModePanel } from './AiModePanel'

vi.mock('@services/ai', () => ({ aiApi: { preferences: vi.fn(), setPreferences: vi.fn() } }))

const caps = (local: boolean) => ({
  generation: { configured: true, provider: 'Groq Cloud', model: 'openai/gpt-oss-20b' },
  providers: { groq: { available: true, reason: null, retryAfter: null, external: true }, local: { available: local, model: local ? 'qwen2.5:3b' : null, external: false } },
}) as unknown as AiCapabilities

describe('AiModePanel', () => {
  beforeEach(() => { vi.mocked(aiApi.preferences).mockReset(); vi.mocked(aiApi.setPreferences).mockReset() })

  it('renders nothing when the server has no external provider (local-only deployments)', () => {
    const { container } = render(<AiModePanel caps={{ generation: {} } as unknown as AiCapabilities} mode="auto" onMode={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('explains the privacy boundary and lets the user opt in', async () => {
    vi.mocked(aiApi.preferences).mockResolvedValue({ externalAiConsent: false })
    vi.mocked(aiApi.setPreferences).mockResolvedValue({ externalAiConsent: true })
    render(<AiModePanel caps={caps(false)} mode="auto" onMode={() => {}} />)
    const allow = await screen.findByRole('button', { name: /Allow fast cloud AI/ })
    expect(screen.getByText(/source excerpts only/)).toBeInTheDocument()
    fireEvent.click(allow)
    await waitFor(() => expect(aiApi.setPreferences).toHaveBeenCalledWith(true))
    expect(await screen.findByText(/sends your question and the relevant excerpts/)).toBeInTheDocument()
  })

  it('only offers private local AI when it is operational', async () => {
    vi.mocked(aiApi.preferences).mockResolvedValue({ externalAiConsent: true })
    const onMode = vi.fn()
    const { rerender } = render(<AiModePanel caps={caps(false)} mode="auto" onMode={onMode} />)
    expect(screen.getByRole('button', { name: /Private Local AI/ })).toBeDisabled()
    rerender(<AiModePanel caps={caps(true)} mode="auto" onMode={onMode} />)
    fireEvent.click(screen.getByRole('button', { name: /Private Local AI/ }))
    expect(onMode).toHaveBeenCalledWith('local')
  })
})
