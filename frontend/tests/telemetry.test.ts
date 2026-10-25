import { describe, expect, it } from 'vitest'
import { freshness, normalizeTelemetry } from '@/lib/telemetry'

const NOW = 1_700_000_000_000

describe('telemetry normalisation', () => {
  it('keeps missing fields null instead of inventing values', () => {
    const t = normalizeTelemetry({ timestamp: NOW }, NOW)!
    expect(t.measured_force_n).toBeNull()
    expect(t.slip_detected).toBeNull()
    expect(t.object_detected).toBeNull()
    expect(t.operation_state).toBeNull()
  })
  it('drops malformed values and accepts 0/1 flags', () => {
    const t = normalizeTelemetry({ measured_force_n: 'x', slip_detected: 1, object_detected: 'yes', timestamp: NOW / 1000 }, NOW)!
    expect(t.measured_force_n).toBeNull()
    expect(t.slip_detected).toBe(true)
    expect(t.object_detected).toBeNull()
    expect(t.timestamp_ms).toBe(NOW) // epoch seconds converted
  })
  it('returns null when the node is absent', () => {
    expect(normalizeTelemetry(null, NOW)).toBeNull()
    expect(freshness(null, NOW, 5).state).toBe('none')
  })
})

describe('staleness', () => {
  const base = { measured_force_n: 1, finger_opening_mm: 1, object_detected: true, slip_detected: false, operation_state: 'holding', received_ms: NOW }
  it('fresh within threshold', () => expect(freshness({ ...base, timestamp_ms: NOW - 1000 }, NOW, 5).state).toBe('fresh'))
  it('stale beyond threshold', () => {
    const f = freshness({ ...base, timestamp_ms: NOW - 12_000 }, NOW, 5)
    expect(f.state).toBe('stale')
    expect(f.reason).toMatch(/12\.0 s old/)
  })
  it('unknown (not fresh) when the hardware sends no timestamp', () => {
    expect(freshness({ ...base, timestamp_ms: null }, NOW, 5).state).toBe('unknown')
    expect(freshness({ ...base, timestamp_ms: null, received_ms: NOW - 9000 }, NOW, 5).state).toBe('stale')
  })
})
