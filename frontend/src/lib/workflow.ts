// Where the operator is in the calibration workflow (drives the stepper and the action bar copy).
export type Step = 1 | 2 | 3 | 4 | 5

export interface WorkflowInput {
  resolution: 'idle' | 'loading' | 'ready' | 'error'
  usingCached: boolean
  hasSession: boolean
  /** the most recent session event is a test_started at the currently selected force */
  testedAtSelected: boolean
  calibratedApplied: boolean
}

export function currentStep(w: WorkflowInput): Step {
  if (w.resolution !== 'ready' && !w.usingCached) return w.resolution === 'loading' ? 2 : 1
  if (w.hasSession) return w.testedAtSelected ? 4 : 3
  return w.calibratedApplied ? 5 : 3
}

export const STEPS: { n: Step; title: string }[] = [
  { n: 1, title: 'Configure' },
  { n: 2, title: 'Initial force' },
  { n: 3, title: 'Test on gripper' },
  { n: 4, title: 'Record result' },
  { n: 5, title: 'Saved & reused' },
]
