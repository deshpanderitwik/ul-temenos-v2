import { useCallback, useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react'

type PrimaryRailProps = {
  children: ReactNode
  className?: string
  /** 0 = empty, 1 = full stroke */
  timerProgress?: number
  timerActive?: boolean
}

export function PrimaryRail({
  children,
  className = '',
  timerProgress = 0,
  timerActive = false
}: PrimaryRailProps) {
  const navRef = useRef<HTMLElement>(null)
  const rectRef = useRef<SVGRectElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [perimeter, setPerimeter] = useState(0)
  const [smoothTransition, setSmoothTransition] = useState(false)
  const [pulsingOut, setPulsingOut] = useState(false)
  const prevActive = useRef(false)

  const measure = useCallback(() => {
    if (!navRef.current) return
    const { offsetWidth: w, offsetHeight: h } = navRef.current
    setSize({ w, h })
  }, [])

  useEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  useEffect(() => {
    if (rectRef.current && size.w > 0) {
      setPerimeter(rectRef.current.getTotalLength())
    }
  }, [size])

  useEffect(() => {
    if (!timerActive) {
      if (prevActive.current) {
        setPulsingOut(true)
      }
      setSmoothTransition(false)
      prevActive.current = false
      return
    }
    prevActive.current = true
    const id = requestAnimationFrame(() => setSmoothTransition(true))
    return () => cancelAnimationFrame(id)
  }, [timerActive])

  const inset = 1
  const rw = size.w - inset * 2
  const rh = size.h - inset * 2
  const rx = Math.min(rw, rh) / 2
  const dashoffset = perimeter * timerProgress

  return (
    <nav
      ref={navRef}
      className={`relative flex flex-col items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] py-2.5 px-1.5 shadow-xl ${className}`.trim()}
      style={{ fontFamily: 'var(--font-ui)' }}
      aria-label="Primary actions"
    >
      {size.w > 0 && (
        <svg
          className="absolute inset-0 pointer-events-none"
          width={size.w}
          height={size.h}
          style={{
            overflow: 'visible',
            visibility: (timerActive && perimeter > 0) || pulsingOut ? 'visible' : 'hidden'
          }}
        >
          <rect
            ref={rectRef}
            x={inset}
            y={inset}
            width={rw}
            height={rh}
            rx={rx}
            ry={rx}
            fill="none"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="2"
            strokeDasharray={pulsingOut ? 0 : perimeter}
            strokeDashoffset={pulsingOut ? 0 : dashoffset}
            strokeLinecap="round"
            onAnimationEnd={() => setPulsingOut(false)}
            style={{
              transition: smoothTransition && !pulsingOut ? 'stroke-dashoffset 150ms linear' : 'none',
              animation: pulsingOut ? 'timer-pulse-out 700ms ease-out forwards' : 'none'
            }}
          />
        </svg>
      )}
      {children}
    </nav>
  )
}

export type PrimaryRailButtonProps = ComponentPropsWithRef<'button'> & {
  label: string
  children: ReactNode
}

export function PrimaryRailButton({
  label,
  children,
  className = '',
  type = 'button',
  ref,
  ...rest
}: PrimaryRailButtonProps) {
  return (
    <button
      ref={ref}
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
