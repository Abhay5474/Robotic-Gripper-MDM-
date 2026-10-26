import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fuzzyFilter, fuzzyScore } from '@/lib/fuzzy'
import { isTypingTarget, keyName } from '@/lib/useHotkeys'
import { currentStep } from '@/lib/workflow'
import { useToasts } from '@/store/toast'

describe('fuzzy matching', () => {
  it('matches subsequences and rejects non-matches', () => {
    expect(fuzzyScore('cal', 'Force & Calibration')).not.toBeNull()
    expect(fuzzyScore('xyz', 'Force & Calibration')).toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
  it('ranks word-start and consecutive matches first', () => {
    const items = ['Settings', 'Live Telemetry', 'Calibration History', 'Force & Calibration']
    expect(fuzzyFilter(items, 'cal', (s) => s)[0]).toMatch(/^Calibration/)
    expect(fuzzyFilter(items, 'tele', (s) => s)).toEqual(['Live Telemetry'])
    expect(fuzzyFilter(items, '', (s) => s)).toEqual(items)
  })
})

describe('hotkeys', () => {
  it('ignores key presses that belong to form fields and dialogs', () => {
    const input = document.createElement('input')
    const div = document.createElement('div')
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); const inside = document.createElement('button'); dialog.append(inside); document.body.append(dialog)
    expect(isTypingTarget(input)).toBe(true)
    expect(isTypingTarget(div)).toBe(false)
    expect(isTypingTarget(inside)).toBe(true)
    dialog.remove()
  })
  it('normalises key names', () => {
    expect(keyName(new KeyboardEvent('keydown', { key: 'T' }))).toBe('t')
    expect(keyName(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }))).toBe('shift+ArrowRight')
    expect(keyName(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))).toBe('ArrowLeft')
  })
})

describe('workflow step', () => {
  const base = { resolution: 'ready' as const, usingCached: false, hasSession: false, testedAtSelected: false, calibratedApplied: false }
  it('walks through the calibration workflow', () => {
    expect(currentStep({ ...base, resolution: 'idle' })).toBe(1)
    expect(currentStep({ ...base, resolution: 'loading' })).toBe(2)
    expect(currentStep(base)).toBe(3)
    expect(currentStep({ ...base, hasSession: true })).toBe(3)
    expect(currentStep({ ...base, hasSession: true, testedAtSelected: true })).toBe(4)
    expect(currentStep({ ...base, calibratedApplied: true })).toBe(5)
    expect(currentStep({ ...base, resolution: 'error', usingCached: true })).toBe(3)
  })
})

describe('toasts', () => {
  beforeEach(() => { vi.useFakeTimers(); useToasts.setState({ toasts: [] }) })
  afterEach(() => vi.useRealTimers())
  it('auto-dismisses and keeps at most four', () => {
    const { push } = useToasts.getState()
    for (let i = 0; i < 6; i++) push({ tone: 'ok', title: `t${i}` })
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(['t2', 't3', 't4', 't5'])
    vi.advanceTimersByTime(4600)
    expect(useToasts.getState().toasts).toEqual([])
  })
  it('can be dismissed manually and kept open with ms=0', () => {
    const id = useToasts.getState().push({ tone: 'bad', title: 'sticky' }, 0)
    vi.advanceTimersByTime(60_000)
    expect(useToasts.getState().toasts).toHaveLength(1)
    useToasts.getState().dismiss(id)
    expect(useToasts.getState().toasts).toHaveLength(0)
  })
})
