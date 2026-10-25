import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, readThemeColors, resolveTheme } from '@/lib/theme'

beforeEach(() => { delete document.documentElement.dataset.theme })

describe('theme', () => {
  it('applies explicit light and dark preferences to <html data-theme>', () => {
    expect(applyTheme('light')).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(applyTheme('dark')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
  it('resolves "system" from the OS preference', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('dark'), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    expect(resolveTheme('system')).toBe('dark')
  })
  it('falls back to dark-theme chart colours when CSS variables are absent', () => {
    expect(readThemeColors().accent).toBeTruthy()
  })
})
