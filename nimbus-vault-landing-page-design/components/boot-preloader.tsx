'use client'

import { useEffect, useMemo, useState } from 'react'

const STATUS_STEPS = [
  'INITIALIZING SECURE ENVIRONMENT',
  'ESTABLISHING ENCRYPTED SESSION',
  'VERIFYING SYSTEM INTEGRITY',
  'PREPARING WORKSPACE',
  'SYSTEM READY',
]

export function BootPreloader() {
  const [visible, setVisible] = useState(true)
  const [progress, setProgress] = useState(8)
  const [ready, setReady] = useState(false)
  const [statusIndex, setStatusIndex] = useState(0)

  const status = useMemo(() => STATUS_STEPS[Math.min(statusIndex, STATUS_STEPS.length - 1)], [statusIndex])

  useEffect(() => {
    let mounted = true
    const signals = new Set<string>()
    const mark = (name: string) => {
      signals.add(name)
      if (!mounted) return
      const next = Math.min(96, 8 + signals.size * 18)
      setProgress((current) => Math.max(current, next))
    }

    const onDomReady = () => mark('dom')
    const onLoad = () => mark('load')
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') mark('interaction')
    }

    if (document.readyState !== 'loading') mark('dom')
    else document.addEventListener('DOMContentLoaded', onDomReady, { once: true })
    if (document.readyState === 'complete') mark('load')
    else window.addEventListener('load', onLoad, { once: true })

    mark('mounted')
    if ('fonts' in document) document.fonts.ready.then(() => mark('fonts')).catch(() => mark('fonts-fallback'))
    else mark('fonts-fallback')
    const images = Array.from(document.images)
    if (images.length === 0 || images.every((image) => image.complete)) mark('assets')
    else Promise.all(images.map((image) => image.decode?.().catch(() => undefined))).then(() => mark('assets'))
    window.addEventListener('keydown', onKey, { once: true })

    const statusTimer = window.setInterval(() => {
      if (mounted) setStatusIndex((current) => Math.min(current + 1, STATUS_STEPS.length - 1))
    }, 560)
    const fallback = window.setTimeout(() => mark('fallback'), 4200)

    return () => {
      mounted = false
      document.removeEventListener('DOMContentLoaded', onDomReady)
      window.removeEventListener('load', onLoad)
      window.removeEventListener('keydown', onKey)
      window.clearInterval(statusTimer)
      window.clearTimeout(fallback)
    }
  }, [])

  useEffect(() => {
    if (progress >= 96) {
      setReady(true)
      setProgress(100)
      const exit = window.setTimeout(() => setVisible(false), 620)
      return () => window.clearTimeout(exit)
    }
  }, [progress])

  if (!visible) return null

  return (
    <div className={`boot-preloader ${ready ? 'is-ready' : ''}`} role="status" aria-live="polite" aria-label="Loading NimbusVault">
      <div className="boot-noise" />
      <div className="boot-center">
        <div className="boot-visual" aria-hidden="true">
          <svg viewBox="0 0 420 300" role="presentation">
            <defs>
              <filter id="boot-glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              <radialGradient id="boot-core"><stop offset="0" stopColor="#fff5ee" /><stop offset=".18" stopColor="#ff8b5a" /><stop offset=".62" stopColor="#ff4d00" stopOpacity=".48" /><stop offset="1" stopColor="#ff4d00" stopOpacity="0" /></radialGradient>
            </defs>
            <g className="boot-construction" fill="none" stroke="#ff4d00" strokeWidth=".8">
              <path d="M118 88 210 32 302 88 302 212 210 268 118 212Z" /><path d="M143 103 210 63 277 103 277 197 210 237 143 197Z" /><path d="M118 88 143 103M302 88 277 103M118 212 143 197M302 212 277 197" />
            </g>
            <g className="boot-orbits" fill="none" stroke="#ff8b5a" strokeWidth="1"><ellipse cx="210" cy="150" rx="168" ry="54" transform="rotate(-18 210 150)" /><ellipse cx="210" cy="150" rx="155" ry="73" transform="rotate(38 210 150)" /><ellipse cx="210" cy="150" rx="75" ry="132" transform="rotate(26 210 150)" /></g>
            <circle className="boot-core-glow" cx="210" cy="150" r="58" fill="url(#boot-core)" filter="url(#boot-glow)" /><rect className="boot-core-box" x="176" y="116" width="68" height="68" rx="8" fill="#170a05" stroke="#ff4d00" /><path d="M193 143h34v25h-34zM199 143v-7a11 11 0 0 1 22 0v7" fill="none" stroke="#fff0e8" strokeWidth="2" /><circle cx="210" cy="154" r="3" fill="#ff4d00" />
            <g className="boot-particles" fill="#ffb092"><circle cx="72" cy="132" r="2" /><circle cx="338" cy="97" r="2" /><circle cx="305" cy="238" r="1.5" /><circle cx="103" cy="229" r="1.5" /></g>
          </svg>
        </div>
        <div className="boot-brand"><span>NIMBUS</span><b>VAULT</b></div>
        <div className="boot-system-label">NIMBUSVAULT <i>//</i> SECURE FILE SYSTEM</div>
        <div className="boot-status"><span className="boot-status-dot" />{status}</div>
        <div className="boot-progress-row"><div className="boot-progress"><span style={{ width: `${progress}%` }} /></div><output>{progress}%</output></div>
      </div>
      <div className="boot-footer">SECURE BY DESIGN. BUILT FOR WHAT&apos;S NEXT.</div>
    </div>
  )
}
