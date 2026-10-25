import { create } from 'zustand'
import { subscribeTelemetry, type ConnState } from '@/lib/firebase'
import { GripperSimulator, type SimOutcomeHint } from '@/lib/simulator'
import { normalizeTelemetry } from '@/lib/telemetry'
import type { GripperLimits, Mode, ObjectProps, Telemetry, TraceRow } from '@/lib/types'

export interface HistPoint { t: number; force: number | null; opening: number | null; slip: number | null; state: string | null }
const MAX_HIST = 600
const MAX_TRACE = 400

interface TState {
  source: 'simulated' | 'firebase' | null
  conn: ConnState
  connDetail: string | null
  latest: Telemetry | null
  history: HistPoint[]
  recording: { active: boolean; startedMs: number; rows: TraceRow[] }
  simRunning: boolean
  simHint: SimOutcomeHint | null
  simRunTime: number
  start: (mode: Mode, path: string, limits: GripperLimits | null) => void
  stop: () => void
  runSim: (object: ObjectProps, force: number) => void
  abortSim: () => void
  startRecording: () => void
  stopRecording: () => TraceRow[]
  clearHistory: () => void
}

let unsub: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null
let sim: GripperSimulator | null = null
let lastHist = 0

function downsample(rows: TraceRow[]): TraceRow[] {
  if (rows.length <= MAX_TRACE) return rows
  const k = rows.length / MAX_TRACE
  return Array.from({ length: MAX_TRACE }, (_, i) => rows[Math.floor(i * k)])
}

export const useTelemetry = create<TState>((set, get) => {
  const ingest = (t: Telemetry) => {
    const now = t.received_ms
    const st = get()
    const patch: Partial<TState> = { latest: t }
    if (now - lastHist >= 100) {
      lastHist = now
      const p: HistPoint = { t: t.timestamp_ms ?? now, force: t.measured_force_n, opening: t.finger_opening_mm, slip: t.slip_detected == null ? null : t.slip_detected ? 1 : 0, state: t.operation_state }
      patch.history = [...st.history, p].slice(-MAX_HIST)
      if (st.recording.active) {
        const row: TraceRow = { t: Number(((now - st.recording.startedMs) / 1000).toFixed(2)), f: t.measured_force_n, o: t.finger_opening_mm, s: t.slip_detected == null ? null : Number(t.slip_detected), st: t.operation_state }
        patch.recording = { ...st.recording, rows: [...st.recording.rows, row] }
      }
    }
    set(patch)
  }

  return {
    source: null, conn: 'disconnected', connDetail: null, latest: null, history: [],
    recording: { active: false, startedMs: 0, rows: [] }, simRunning: false, simHint: null, simRunTime: 0,

    start(mode, path, limits) {
      get().stop()
      set({ latest: null, history: [], conn: 'connecting', connDetail: null, simRunning: false, simHint: null })
      if (mode === 'live') {
        set({ source: 'firebase' })
        unsub = subscribeTelemetry(
          path,
          (raw) => {
            const t = normalizeTelemetry(raw, Date.now())
            if (t) ingest(t)
            else set({ latest: null })
          },
          (conn, detail) => set({ conn, connDetail: detail ?? null }),
        )
      } else if (limits) {
        sim = new GripperSimulator(limits)
        set({ source: 'simulated', conn: 'connected' })
        let last = performance.now()
        timer = setInterval(() => {
          const nowP = performance.now()
          const dt = Math.min(0.25, (nowP - last) / 1000)
          last = nowP
          const raw = sim!.step(dt, Date.now())
          ingest({ ...raw, timestamp_ms: raw.timestamp, received_ms: Date.now() })
          const running = sim!.running
          if (running !== get().simRunning || sim!.hint !== get().simHint || running) set({ simRunning: running, simHint: sim!.hint, simRunTime: sim!.runTime })
        }, 100)
      }
    },

    stop() {
      unsub?.(); unsub = null
      if (timer) clearInterval(timer)
      timer = null; sim = null
      set({ source: null, conn: 'disconnected', simRunning: false })
    },

    runSim(object, force) { if (sim && !sim.running) { sim.start(object, force); get().clearHistory(); get().startRecording() } },
    abortSim() { sim?.abort() },
    startRecording() { set({ recording: { active: true, startedMs: Date.now(), rows: [] } }) },
    stopRecording() {
      const rows = downsample(get().recording.rows)
      set({ recording: { active: false, startedMs: 0, rows: [] } })
      return rows
    },
    clearHistory() { set({ history: [] }); lastHist = 0 },
  }
})
