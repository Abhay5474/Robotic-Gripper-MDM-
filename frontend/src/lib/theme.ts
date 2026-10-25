export type ThemePref = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

const mq = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)
export const resolveTheme = (pref: ThemePref): Theme => (pref === 'system' ? (mq()?.matches ? 'dark' : 'light') : pref)

export function applyTheme(pref: ThemePref): Theme {
  const t = resolveTheme(pref)
  document.documentElement.dataset.theme = t
  return t
}

/** Calls cb whenever the OS preference changes (only meaningful while pref === 'system'). */
export function watchSystemTheme(cb: () => void): () => void {
  const m = mq()
  if (!m) return () => {}
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

export interface ThemeColors {
  accent: string; llm: string; cal: string; meas: string; bad: string; ok: string; warn: string
  object: string; on: string; grid: string; axis: string; opening: string; slip: string
  sceneBg: string; sceneGridA: string; sceneGridB: string; metal: string; palm: string; stem: string
}

export function readThemeColors(): ThemeColors {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d
  return {
    accent: v('--color-accent', '#22d3ee'), llm: v('--color-llm', '#a78bfa'), cal: v('--color-cal', '#34d399'), meas: v('--color-meas', '#fb923c'),
    bad: v('--color-bad', '#f87171'), ok: v('--color-ok', '#34d399'), warn: v('--color-warn', '#fbbf24'),
    object: v('--c-object', '#22d3ee'), on: v('--c-on', '#0b1220'), grid: v('--c-grid', '#1e2a47'), axis: v('--c-axis', '#64748b'), opening: v('--c-opening', '#38bdf8'), slip: v('--c-slip', '#f87171'),
    sceneBg: v('--c-scene-bg', '#0b1220'), sceneGridA: v('--c-scene-grid-a', '#27355a'), sceneGridB: v('--c-scene-grid-b', '#18223d'),
    metal: v('--c-metal', '#94a3b8'), palm: v('--c-palm', '#475569'), stem: v('--c-stem', '#334155'),
  }
}
