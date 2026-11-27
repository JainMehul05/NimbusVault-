import { useEffect, useState } from 'react'
import { api } from '@services/api'

/** Where the NimbusVault server (and its MiniLM/Qwen runtime) is running. */
export type RuntimeHost = 'local' | 'ec2'

/**
 * Reads the public health endpoint once. Defaults to 'local' so the Windows
 * standalone application keeps its original wording if the call fails.
 */
export function useRuntimeHost(): RuntimeHost {
  const [host, setHost] = useState<RuntimeHost>('local')
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await api.get('/health')
        if (active && response?.data?.data?.host === 'ec2') setHost('ec2')
      } catch {
        // Unknown host keeps the original local wording.
      }
    }
    void load()
    return () => { active = false }
  }, [])
  return host
}

export const runtimeHostLabel = (host: RuntimeHost) => (host === 'ec2' ? 'On the AWS EC2 host · Sydney' : 'On this laptop')
export const runtimeHostPhrase = (host: RuntimeHost) => (host === 'ec2' ? 'on the NimbusVault EC2 server' : 'on your laptop')
