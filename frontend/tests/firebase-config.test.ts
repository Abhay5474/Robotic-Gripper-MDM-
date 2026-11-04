import { afterEach, describe, expect, it, vi } from 'vitest'

const cfg = { VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_DATABASE_URL: 'https://x-default-rtdb.firebaseio.com', VITE_FIREBASE_PROJECT_ID: 'x' }
const load = async (env: Record<string, string>) => {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('@/lib/firebase')
}

describe('Firebase web config switch', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('LIVE mode is configured when the web config is present', async () => {
    expect((await load(cfg)).firebaseConfigured).toBe(true)
  })
  it('VITE_FIREBASE_DISABLED=1 (offline launcher) ignores the committed config', async () => {
    const m = await load({ ...cfg, VITE_FIREBASE_DISABLED: '1' })
    expect(m.firebaseConfigured).toBe(false)
    const conn = vi.fn()
    m.subscribeTelemetry('gripper_telemetry', () => {}, conn)
    expect(conn).toHaveBeenCalledWith('unconfigured', expect.any(String))
  })
})
