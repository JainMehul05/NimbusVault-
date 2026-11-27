import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { api } from '@services/api'
import { useRuntimeHost, runtimeHostLabel, runtimeHostPhrase } from './useRuntimeHost'

vi.mock('@services/api', () => ({ api: { get: vi.fn() } }))

describe('useRuntimeHost', () => {
  beforeEach(() => vi.mocked(api.get).mockReset())

  it('reports the EC2 host only when the server says so', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: { host: 'ec2' } } })
    const { result } = renderHook(() => useRuntimeHost())
    await waitFor(() => expect(result.current).toBe('ec2'))
    expect(runtimeHostLabel(result.current)).toContain('EC2')
    expect(runtimeHostPhrase(result.current)).not.toContain('laptop')
  })

  it('keeps the original Windows wording for a local or malformed response', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: { host: 'local' } } })
    const { result } = renderHook(() => useRuntimeHost())
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/health'))
    expect(result.current).toBe('local')
    expect(runtimeHostLabel(result.current)).toBe('On this laptop')
    expect(runtimeHostPhrase(result.current)).toBe('on your laptop')
  })
})
