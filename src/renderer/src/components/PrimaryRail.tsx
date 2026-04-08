import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Vertical “pill” rail for persistent, icon-first actions.
 *
 * Extension pattern: add more controls as <PrimaryRailButton> children (or small
 * grouped fragments). When actions need shared state (editor, modals), compose
 * the rail inside a workspace/shell component and pass callbacks — avoid
 * importing feature modules from this file so the rail stays a dumb shell.
 */
type PrimaryRailProps = {
  children: ReactNode
  className?: string
}

export function PrimaryRail({ children, className = '' }: PrimaryRailProps) {
  return (
    <nav
      className={`flex flex-col items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] py-2.5 px-1.5 shadow-xl ${className}`.trim()}
      style={{ fontFamily: 'var(--font-ui)' }}
      aria-label="Primary actions"
    >
      {children}
    </nav>
  )
}

export type PrimaryRailButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  children: ReactNode
}

export function PrimaryRailButton({
  label,
  children,
  className = '',
  type = 'button',
  ...rest
}: PrimaryRailButtonProps) {
  return (
    <button
      type={type}
      className={`text-gray-400 p-2.5 rounded-full transition-all hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed ${className}`.trim()}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
}
