import { useEffect } from 'react'
import { create } from 'zustand'
import { applyTheme, readThemeColors, watchSystemTheme, type Theme, type ThemeColors, type ThemePref } from '@/lib/theme'
import { loadSettings, saveSettings } from '@/lib/settings'

interface ThemeState { pref: ThemePref; resolved: Theme; colors: ThemeColors | null; setPref: (p: ThemePref) => void; refresh: () => void }

export const useTheme = create<ThemeState>((set, get) => ({
  pref: loadSettings().theme,
  resolved: 'dark',
  colors: null,
  setPref(pref) {
    saveSettings({ ...loadSettings(), theme: pref })
    set({ pref })
    get().refresh()
  },
  refresh() {
    const resolved = applyTheme(get().pref)
    // colours are read after the attribute flips so CSS variables already reflect the new theme
    requestAnimationFrame(() => set({ resolved, colors: readThemeColors() }))
    set({ resolved })
  },
}))

/** Mount once: applies the theme and follows the OS setting while the preference is "system". */
export function useThemeBootstrap() {
  const pref = useTheme((s) => s.pref)
  const refresh = useTheme((s) => s.refresh)
  useEffect(() => { refresh(); return pref === 'system' ? watchSystemTheme(refresh) : undefined }, [pref, refresh])
}

/** Resolved CSS-variable colours for chart / WebGL code that cannot use Tailwind classes. */
export function useThemeColors(): ThemeColors {
  const colors = useTheme((s) => s.colors)
  return colors ?? readThemeColors()
}
