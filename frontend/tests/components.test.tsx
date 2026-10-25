import { render, screen } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'
import cases from '@shared/safety_cases.json'
import { ModeBadge } from '@/components/ModeBadge'
import TelemetryTiles from '@/components/TelemetryTiles'
import ForceSlider from '@/components/ForceSlider'
import { assess } from '@/lib/safety'
import type { GripperLimits, Health, ObjectProps } from '@/lib/types'
import { useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'
import { fireEvent } from '@testing-library/react'

const limits = cases.limits as GripperLimits
const bottle = cases.cases[0].object as ObjectProps

describe('demo vs live are visually and textually distinct', () => {
  it('labels demo mode as simulated', () => {
    render(<ModeBadge mode="demo" />)
    expect(screen.getByTestId('mode-badge')).toHaveTextContent('DEMO MODE · SIMULATED')
  })
  it('labels live mode as Firebase', () => {
    render(<ModeBadge mode="live" />)
    expect(screen.getByTestId('mode-badge')).toHaveTextContent('LIVE MODE · FIREBASE')
  })
})

describe('telemetry tiles', () => {
  beforeEach(() => useTelemetry.setState({ latest: null, source: null }))
  it('shows unavailable (not zero) with no data', () => {
    render(<TelemetryTiles />)
    expect(screen.getAllByText('unavailable').length).toBeGreaterThanOrEqual(5)
    expect(screen.getByText('No data')).toBeInTheDocument()
  })
  it('warns when the telemetry is stale', () => {
    useApp.setState({ health: { telemetry: { stale_after_s: 5 } } as Health })
    useTelemetry.setState({ source: 'firebase', latest: { measured_force_n: 4, finger_opening_mm: null, object_detected: true, slip_detected: null, operation_state: 'holding', timestamp_ms: Date.now() - 60_000, received_ms: Date.now() } })
    render(<TelemetryTiles />)
    expect(screen.getByText('STALE')).toBeInTheDocument()
    expect(screen.getByTestId('freshness-reason')).toHaveTextContent(/old/)
    expect(screen.getAllByText('unavailable').length).toBeGreaterThanOrEqual(2) // opening + slip missing
  })
})

describe('force slider', () => {
  beforeEach(() => {
    useApp.setState({
      health: { limits, command_channel: 'none' } as unknown as Health,
      resolution: { status: 'ready', data: null, error: null, object: bottle, cached: null, usingCached: false },
      selectedForce: 8,
    })
  })
  it('is a real control: moving it updates the selected target', () => {
    render(<ForceSlider />)
    expect(screen.getByTestId('selected-force')).toHaveTextContent('8.00')
    fireEvent.change(screen.getByLabelText('Gripping force (N)'), { target: { value: '12' } })
    expect(useApp.getState().selectedForce).toBe(12)
    expect(screen.getByTestId('selected-force')).toHaveTextContent('12.00')
  })
  it('exposes limits, step, unit and says the gripper did not receive the value', () => {
    render(<ForceSlider />)
    expect(screen.getByText(/min 1 N/)).toBeInTheDocument()
    expect(screen.getByText(/max 40 N/)).toBeInTheDocument()
    expect(screen.getByText(/step 0.5 N/)).toBeInTheDocument()
    expect(screen.getByText(/demo limits, not validated/)).toBeInTheDocument()
    expect(screen.getByTestId('command-status')).toHaveTextContent(/NOT received|software simulation/)
  })
  it('shows a blocking safety status for an over-limit force', () => {
    useApp.setState({ selectedForce: 25 })
    render(<ForceSlider />)
    expect(assess(bottle, limits, 25).status).toBe('exceeds_limit')
    expect(screen.getByText('Exceeds limit')).toBeInTheDocument()
  })
  it('is disabled until a configuration is resolved', () => {
    useApp.setState({ selectedForce: null })
    render(<ForceSlider />)
    expect(screen.getByLabelText('Gripping force (N)')).toBeDisabled()
  })
})
