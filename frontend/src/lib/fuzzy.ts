/**
 * Subsequence fuzzy match. Returns a score (higher = better) or null when `query` is not a subsequence of `text`.
 * Rewards consecutive characters and matches at word starts, so "frc cal" ranks "Force & Calibration" first.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const t = text.toLowerCase()
  let score = 0, ti = 0, run = 0
  for (const ch of q) {
    const idx = t.indexOf(ch, ti)
    if (idx < 0) return null
    const wordStart = idx === 0 || /[\s\-_/&·:]/.test(t[idx - 1])
    run = idx === ti ? run + 1 : 0
    score += 1 + run * 2 + (wordStart ? 3 : 0) - Math.min(3, (idx - ti) * 0.1)
    ti = idx + 1
  }
  return score - t.length * 0.01
}

export function fuzzyFilter<T>(items: T[], query: string, text: (t: T) => string): T[] {
  if (!query.trim()) return items
  return items
    .map((it, i) => ({ it, i, s: fuzzyScore(query, text(it)) }))
    .filter((x): x is { it: T; i: number; s: number } => x.s != null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.it)
}
