import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '@/lib/api'
import type { MlPrediction } from '@/lib/types'
import { useApp } from './app'

interface MlState { data: MlPrediction | null; objectKey: string | null }
export const useMl = create<MlState>(() => ({ data: null, objectKey: null }))

const POLL_MS = 8000

/** Keeps the ML Lab's prediction for the current object fresh (mounted once, in the layout). */
export function useMlSync() {
  const object = useApp((s) => s.resolution.object)
  const mode = useApp((s) => s.settings.mode)
  const key = object ? JSON.stringify(object) : null
  useEffect(() => {
    if (!object || !key) { useMl.setState({ data: null, objectKey: null }); return }
    let alive = true
    if (useMl.getState().objectKey !== key) useMl.setState({ data: null, objectKey: key })
    const load = () => api.mlPrediction(mode, object)
      .then((d) => { if (alive) useMl.setState({ data: d, objectKey: key }) })
      .catch((e: Error) => { if (alive) useMl.setState({ data: { available: false, reason: e.message }, objectKey: key }) })
    load()
    const id = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode])
}

/** The ML model's recommended force for the current object, or null when unavailable. */
export const useMlForce = () => useMl((s) => (s.data?.available ? s.data.model_recommended : null))
