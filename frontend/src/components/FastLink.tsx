// Links whose navigation commits immediately (ReactDOM.flushSync) instead of in a low-priority transition.
// Without this, a page that is animating a WebGL scene can starve the route transition on slow GPUs.
import type { MouseEvent } from 'react'
import { Link, NavLink, useNavigate, type LinkProps, type NavLinkProps } from 'react-router-dom'

const plainLeftClick = (e: MouseEvent<HTMLAnchorElement>) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented

export function useFastNavigate() {
  const navigate = useNavigate()
  return (to: string) => navigate(to, { flushSync: true })
}

export function FastNavLink({ to, onClick, ...rest }: NavLinkProps & { to: string }) {
  const go = useFastNavigate()
  return <NavLink to={to} {...rest} onClick={(e) => { onClick?.(e); if (plainLeftClick(e)) { e.preventDefault(); go(to) } }} />
}

export function FastLink({ to, onClick, ...rest }: LinkProps & { to: string }) {
  const go = useFastNavigate()
  return <Link to={to} {...rest} onClick={(e) => { onClick?.(e); if (plainLeftClick(e)) { e.preventDefault(); go(to) } }} />
}
