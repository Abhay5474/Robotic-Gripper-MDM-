// Small procedural textures for the 3D view (no image assets, nothing fetched). Browser-only.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

const cache = new Map<string, CanvasTexture>()

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const hit = cache.get(key)
  if (hit) return hit
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const g = cv.getContext('2d')!
  draw(g)
  const t = new CanvasTexture(cv)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 4
  cache.set(key, t)
  return t
}

// deterministic pseudo-random so textures are identical on every load
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

export const woodTexture = () => make('wood', 256, 256, (g) => {
  g.fillStyle = '#c4935c'; g.fillRect(0, 0, 256, 256)
  const r = rng(7)
  for (let i = 0; i < 46; i++) {
    const y = r() * 256, a = 0.05 + r() * 0.16, amp = 3 + r() * 6
    g.strokeStyle = `rgba(92,54,24,${a})`; g.lineWidth = 1 + r() * 3
    g.beginPath()
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin(x / 38 + i) * amp)
    g.stroke()
  }
  g.fillStyle = 'rgba(255,240,215,0.08)'; g.fillRect(0, 0, 256, 256)
})

export const cardboardTexture = () => make('cardboard', 256, 256, (g) => {
  g.fillStyle = '#c9a274'; g.fillRect(0, 0, 256, 256)
  const r = rng(11)
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(110,75,35,${r() * 0.08})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1) }
  g.strokeStyle = 'rgba(95,62,28,0.55)'; g.lineWidth = 6
  for (const x of [88, 168]) { g.beginPath(); g.moveTo(x, 190); g.lineTo(x, 110); g.stroke(); g.beginPath(); g.moveTo(x - 18, 128); g.lineTo(x, 104); g.lineTo(x + 18, 128); g.stroke() }
  g.fillStyle = 'rgba(95,62,28,0.6)'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('THIS WAY UP', 128, 226)
})

export const canLabelTexture = () => make('can', 512, 256, (g) => {
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#b91c1c'); grad.addColorStop(1, '#7f1d1d')
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256)
  g.strokeStyle = '#fef2f2'; g.lineWidth = 16
  g.beginPath(); for (let x = 0; x <= 512; x += 8) g.lineTo(x, 150 + Math.sin(x / 40) * 22); g.stroke()
  g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'
  g.fillText('GRIP', 128, 105); g.fillText('GRIP', 384, 105)
})

export const bottleLabelTexture = () => make('bottle', 512, 128, (g) => {
  g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, 512, 128)
  g.fillStyle = '#e0f2fe'; g.fillRect(0, 96, 512, 10)
  g.fillStyle = '#fff'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'
  g.fillText('AQUA', 128, 78); g.fillText('AQUA', 384, 78)
})
