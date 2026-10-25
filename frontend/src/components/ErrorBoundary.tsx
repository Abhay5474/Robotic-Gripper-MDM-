import { Component, type ReactNode } from 'react'

/** Keeps a failing optional widget (e.g. WebGL unavailable) from taking the whole console down. */
export default class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.warn('Widget failed to render:', e) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
