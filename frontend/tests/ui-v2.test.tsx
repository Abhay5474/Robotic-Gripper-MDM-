import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import cases from '@shared/safety_cases.json'
import type { GripperLimits, Health, ObjectProps } from '@/lib/types'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, lookup: vi.fn(), predict: vi.fn() } }
})
vi.mock('@/lib/firebase', () => ({ subscribeTelemetry: () => () => {}, firebaseConfigured: false }))

import { api } from '@/lib/api'
import CommandPalette from '@/components/CommandPalette'
import ObjectArt from '@/components/ObjectArt'
import SceneView from '@/components/SceneView'
import WorkflowStepper from '@/components/WorkflowStepper'
import { Modal } from '@/components/ui'
import GripDiagram from '@/components/viz/GripDiagram'
import { toForm } from '@/lib/objects'
import Objects from '@/pages/Objects'
import { useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'

const limits = cases.limits as GripperLimits
const bottle = cases.cases[0].object as ObjectProps
const health = { status: 'ok', limits, telemetry: { path: 'gripper_telemetry', stale_after_s: 5 }, command_channel: 'none', allow_safety_override: false } as unknown as Health

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ health, form: toForm(bottle), presetId: bottle.object_id, session: null, selectedForce: 8,
    resolution: { status: 'ready', data: null, error: null, object: bottle, cached: null, usingCached: false } })
  useTelemetry.setState({ latest: null, source: null })
})

describe('free-body diagram', () => {
  it('reports the grip margin = N / N_required with the right tone', () => {
    const { rerender } = render(<GripDiagram object={bottle} limits={limits} force={8} />)
    const box = screen.getByTestId('grip-margin')
    expect(box).toHaveTextContent('×1.55') // 8 / 5.165
    expect(within(box).getByText('×1.55').className).toContain('text-ok')
    rerender(<GripDiagram object={bottle} limits={limits} force={6} />)
    expect(within(screen.getByTestId('grip-margin')).getByText('×1.16').className).toContain('text-warn')
    rerender(<GripDiagram object={bottle} limits={limits} force={3} />)
    expect(within(screen.getByTestId('grip-margin')).getByText('×0.58').className).toContain('text-bad')
  })
  it('describes the balance for screen readers and shows measured margin when available', () => {
    render(<GripDiagram object={bottle} limits={limits} force={8} measured={7.5} openingMm={65} />)
    expect(screen.getByRole('img')).toHaveAccessibleName(/friction capacity 6\.40 N against a load of 4\.13 N/)
    expect(screen.getByTestId('grip-margin')).toHaveTextContent('measured ×1.45')
  })
  it('does not report a measured margin while nothing is gripped (0 N)', () => {
    render(<GripDiagram object={bottle} limits={limits} force={8} measured={0} />)
    expect(screen.getByTestId('grip-margin')).toHaveTextContent('×1.55')
    expect(screen.getByTestId('grip-margin')).not.toHaveTextContent('measured')
  })
})

describe('3D view fallback', () => {
  it('shows the 2D free-body diagram when WebGL is unavailable (jsdom has none)', () => {
    render(<MemoryRouter><SceneView /></MemoryRouter>)
    expect(screen.getByText(/3D view unavailable/)).toBeInTheDocument()
    expect(screen.getByTestId('grip-diagram')).toBeInTheDocument()
    expect(screen.getByTestId('scene-readouts')).toHaveTextContent('opening unavailable')
    expect(screen.getByTestId('scene-readouts')).toHaveTextContent('force unavailable')
  })
  it('shows the target margin, labelled as such, while nothing is gripped', () => {
    const sample = { finger_opening_mm: 120, object_detected: false, slip_detected: false, operation_state: 'idle', timestamp_ms: 1, received_ms: 1 }
    useTelemetry.setState({ latest: { ...sample, measured_force_n: 0 } })
    const { unmount } = render(<MemoryRouter><SceneView /></MemoryRouter>)
    expect(screen.getByTestId('scene-readouts')).toHaveTextContent('grip margin (target) ×1.55') // selected 8 N
    unmount()
    useTelemetry.setState({ latest: { ...sample, measured_force_n: 7.5, object_detected: true, operation_state: 'holding' } })
    render(<MemoryRouter><SceneView /></MemoryRouter>)
    expect(screen.getByTestId('scene-readouts')).toHaveTextContent(/grip margin ×1\.45/)
    expect(screen.getByTestId('scene-readouts')).not.toHaveTextContent('(target)')
  })
  it('labels replays and keeps their data separate from live telemetry', () => {
    useTelemetry.setState({ latest: { measured_force_n: 99, finger_opening_mm: 1, object_detected: true, slip_detected: false, operation_state: 'holding', timestamp_ms: 1, received_ms: 1 } })
    render(<MemoryRouter><SceneView override={{ measured_force_n: 4.2, operation_state: 'lifting' }} progress={0.5} /></MemoryRouter>)
    expect(screen.getByText('REPLAY')).toBeInTheDocument()
    expect(screen.getByTestId('scene-readouts')).toHaveTextContent('4.20 N')
    expect(screen.getByTestId('scene-readouts')).not.toHaveTextContent('99')
  })
})

describe('object gallery', () => {
  it('shows a calibration badge per preset from one lookup call (no LLM)', async () => {
    vi.mocked(api.lookup).mockResolvedValue({ llm_called: false, items: [
      { object_id: 'plastic-bottle', configuration_key: 'cfg_' + 'a'.repeat(32), state: 'found_valid', calibrated_force: 9.5 },
      { object_id: 'rubber-ball', configuration_key: 'cfg_' + 'b'.repeat(32), state: 'invalidated' },
      { object_id: 'cardboard-box', configuration_key: 'cfg_' + 'c'.repeat(32), state: 'stale', calibrated_force: 4 },
    ] })
    render(<MemoryRouter><Objects /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('preset-plastic-bottle')).toHaveTextContent('Calibrated · 9.50 N'))
    expect(screen.getByTestId('preset-rubber-ball')).toHaveTextContent('Invalidated')
    expect(screen.getByTestId('preset-cardboard-box')).toHaveTextContent('Calibration stale')
    expect(api.lookup).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.lookup).mock.calls[0][1]).toHaveLength(8)
    expect(api.predict).not.toHaveBeenCalled()
    expect(screen.getByTestId('preset-plastic-bottle')).toHaveAttribute('aria-checked', 'true')
  })
  it('flags an edited preset and degrades gracefully when the lookup fails', async () => {
    vi.mocked(api.lookup).mockRejectedValue(new Error('down'))
    useApp.setState({ form: { ...toForm(bottle), mass_g: '400' } })
    render(<MemoryRouter><Objects /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('status unavailable').length).toBe(8))
    expect(within(screen.getByTestId('preset-plastic-bottle')).getByText('edited')).toBeInTheDocument()
  })
})

function Where() { return <div data-testid="where">{useLocation().pathname}</div> }

describe('command palette', () => {
  it('filters as you type and runs the highlighted command with Enter', () => {
    const onClose = vi.fn()
    render(<MemoryRouter><CommandPalette open onClose={onClose} /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'telem' } })
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Live Telemetry')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent('/telemetry')
  })
  it('focuses the input as it opens and starts every opening with an empty query', () => {
    const ui = (open: boolean) => <MemoryRouter><CommandPalette open={open} onClose={() => {}} /></MemoryRouter>
    const { rerender } = render(ui(true))
    expect(screen.getByRole('combobox')).toHaveFocus() // focused in the commit, so early keystrokes are not lost
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cup' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    rerender(ui(false))
    expect(screen.queryByRole('combobox')).toBeNull()
    rerender(ui(true))
    expect(screen.getByRole('combobox')).toHaveValue('')
  })
  it('moves the selection with the arrow keys and skips disabled commands', () => {
    useApp.setState({ session: { record: {} as never, events: [], busy: false, error: null } })
    render(<MemoryRouter><CommandPalette open onClose={() => {}} /></MemoryRouter>)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'switch to' } })
    const opts = screen.getAllByRole('option')
    expect(opts.every((o) => o.getAttribute('aria-disabled') === 'true')).toBe(true) // mode is locked during a session
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  })
})

describe('object art', () => {
  it('renders at the size it is given (the default must not override it)', () => {
    const { container, rerender } = render(<ObjectArt kind="cup" className="size-5" />)
    expect(container.querySelector('svg')).toHaveAttribute('class', 'size-5')
    rerender(<ObjectArt kind="cup" />)
    expect(container.querySelector('svg')).toHaveAttribute('class', 'size-14')
  })
})

describe('modal + stepper', () => {
  it('closes on Escape and labels itself', () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} title="Confirm it"><button>ok</button></Modal>)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Confirm it')
    expect(screen.getByText('ok')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('marks completed and current steps', () => {
    render(<WorkflowStepper step={4} detail={{ 2: 'LLM estimate' }} />)
    const items = screen.getAllByRole('listitem')
    expect(items[3]).toHaveAttribute('aria-current', 'step')
    expect(items[1]).toHaveTextContent('LLM estimate')
  })
})
