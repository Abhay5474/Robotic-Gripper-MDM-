import { create } from 'zustand'

export type ToastTone = 'ok' | 'warn' | 'bad' | 'neutral'
export interface Toast { id: number; tone: ToastTone; title: string; body?: string }

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>, ms?: number) => number
  dismiss: (id: number) => void
}

let nextId = 1
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(t, ms = 4500) {
    const id = nextId++
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) })
    if (ms > 0) setTimeout(() => get().dismiss(id), ms)
    return id
  },
  dismiss(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }) },
}))

export const toast = (t: Omit<Toast, 'id'>, ms?: number) => useToasts.getState().push(t, ms)
