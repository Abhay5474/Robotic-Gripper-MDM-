import { useEffect, useRef } from 'react'

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>

/** True when the key press belongs to a text field or another widget that uses the keyboard itself. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable || !!el.closest?.('[role="dialog"]')
}

/** Keys are matched on `e.key` (case-insensitive for letters); "shift+ArrowRight" style combos are supported. */
export function keyName(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  return e.shiftKey && e.key.length > 1 ? `shift+${k}` : k
}

export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      const fn = ref.current[keyName(e)]
      if (fn) { e.preventDefault(); fn(e) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [enabled])
}
