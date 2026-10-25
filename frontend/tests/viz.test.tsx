import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import cases from '@shared/safety_cases.json'
import ThemeToggle from '@/components/ThemeToggle'
import ForceEnvelope from '@/components/viz/ForceEnvelope'
import ForceGauge from '@/components/viz/ForceGauge'
import type { GripperLimits, Health, ObjectProps } from '@/lib/types'
import { useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'
import { useTheme } from '@/store/theme'

const limits = cases.limits as GripperLimits
const bottle = cases.cases[0].object as ObjectProps

beforeEach(() => {
  useApp.setState({
    health: { limits, command_channel: 'none' } as unknown as Health,
    resolution: { status: 'ready', data: null, error: null, object: bottle, cached: null, usingCached: false },
    selectedForce: 8,
    session: null,
  })
  useTelemetry.setState({ latest: null, source: null })
})

describe('force gauge', () => {
  it('shows unavailable instead of a number when there is no measurement', () => {
    render(<ForceGauge />)
    expect(screen.getByTestId('force-gauge')).toHaveTextContent('unavailable')
    expect(screen.getByRole('img')).toHaveAccessibleName(/Measured unavailable/)
  })
  it('reports the measured value and the deviation from the target', () => {
    useTelemetry.setState({ latest: { measured_force_n: 7.5, finger_opening_mm: 60, object_detected: true, slip_detected: false, operation_state: 'holding', timestamp_ms: Date.now(), received_ms: Date.now() } })
    render(<ForceGauge />)
    expect(screen.getByTestId('force-gauge')).toHaveTextContent('7.50 N')
    expect(screen.getByTestId('force-gauge')).toHaveTextContent('Δ -0.50 N')
  })
})

describe('force envelope', () => {
  it('has an accessible text summary of the permitted range', () => {
    render(<ForceEnvelope />)
    expect(screen.getByRole('img')).toHaveAccessibleName(/Estimated permitted range 7\.748 to 20 N/)
  })
  it('plots each test of the session', () => {
    useApp.setState({ session: { record: {} as never, busy: false, error: null, events: [{ event: 'test_started', force: 3, at: 1 }, { event: 'slipped', force: 3, at: 2 }, { event: 'test_started', force: 5.5, at: 3 }] } })
    render(<ForceEnvelope />)
    expect(screen.getByText('Test 1: 3 N - slipped', { selector: 'title' })).toBeInTheDocument()
    expect(screen.getByText('Test 2: 5.5 N - pending', { selector: 'title' })).toBeInTheDocument()
  })
})

describe('theme toggle', () => {
  it('switches <html data-theme> and persists the preference', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByLabelText('Dark theme'))
    expect(useTheme.getState().pref).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    fireEvent.click(screen.getByLabelText('Light theme'))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(JSON.parse(localStorage.getItem('gripsense.settings.v1') ?? '{}').theme).toBe('light')
  })
})
