import { useCallback, useEffect, useRef, useState } from 'react'
import { PlayIcon, PauseIcon, StopIcon } from '@heroicons/react/24/solid'

type TimerState = 'idle' | 'running' | 'paused'

export type TimerPopoverProps = {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
  onTimerStateChange?: (state: TimerState, remainingSeconds: number, totalSeconds: number) => void
}

export default function TimerPopover({ open, onClose, anchorRef, onTimerStateChange }: TimerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [minutes, setMinutes] = useState(() => localStorage.getItem('timer-minutes') ?? '25')
  const [seconds, setSeconds] = useState(() => localStorage.getItem('timer-seconds') ?? '00')
  const [top, setTop] = useState(0)
  const [left, setLeft] = useState(0)

  const [timerState, setTimerState] = useState<TimerState>('idle')
  const [remainingMs, setRemainingMs] = useState(0)
  const [totalMs, setTotalMs] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const endTimeRef = useRef(0)

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const notifyState = useCallback(
    (state: TimerState, remaining: number, total: number) => {
      onTimerStateChange?.(state, remaining, total)
    },
    [onTimerStateChange]
  )

  const totalMsRef = useRef(0)
  totalMsRef.current = totalMs

  const tick = useCallback(() => {
    const now = Date.now()
    const remaining = Math.max(0, endTimeRef.current - now)
    setRemainingMs(remaining)

    if (remaining <= 0) {
      clearTimer()
      setTimerState('idle')
      notifyState('idle', 0, 0)
    } else {
      notifyState('running', remaining, totalMsRef.current)
    }
  }, [clearTimer, notifyState])

  const startTimer = useCallback(() => {
    const mins = parseInt(minutes, 10) || 0
    const secs = parseInt(seconds, 10) || 0
    const total = (mins * 60 + secs) * 1000
    if (total <= 0) return

    localStorage.setItem('timer-minutes', minutes)
    localStorage.setItem('timer-seconds', seconds)

    setTotalMs(total)
    setRemainingMs(total)
    endTimeRef.current = Date.now() + total

    clearTimer()
    intervalRef.current = setInterval(tick, 100)

    setTimerState('running')
    notifyState('running', total, total)
  }, [minutes, seconds, clearTimer, tick, notifyState])

  const pauseTimer = useCallback(() => {
    clearTimer()
    const remaining = Math.max(0, endTimeRef.current - Date.now())
    setRemainingMs(remaining)
    setTimerState('paused')
    notifyState('paused', remaining, totalMs)
  }, [clearTimer, totalMs, notifyState])

  const resumeTimer = useCallback(() => {
    endTimeRef.current = Date.now() + remainingMs
    clearTimer()
    intervalRef.current = setInterval(tick, 100)
    setTimerState('running')
    notifyState('running', remainingMs, totalMs)
  }, [remainingMs, totalMs, clearTimer, tick, notifyState])

  const stopTimer = useCallback(() => {
    clearTimer()
    setRemainingMs(0)
    setTotalMs(0)
    setTimerState('idle')
    notifyState('idle', 0, 0)
  }, [clearTimer, notifyState])

  useEffect(() => {
    return () => clearTimer()
  }, [clearTimer])

  useEffect(() => {
    if (!open || !anchorRef.current) return

    const rect = anchorRef.current.getBoundingClientRect()
    setTop(rect.top + rect.height / 2)
    setLeft(rect.right + 12)
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        !(anchorRef.current && anchorRef.current.contains(target))
      ) {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, onClose])

  const handleTimeInput = useCallback(
    (value: string, setter: (v: string) => void, max: number) => {
      const cleaned = value.replace(/\D/g, '').slice(0, 2)
      const num = parseInt(cleaned, 10)
      if (cleaned === '' || (num >= 0 && num <= max)) {
        setter(cleaned)
      }
    },
    []
  )

  const handleBlur = useCallback(
    (value: string, setter: (v: string) => void) => {
      setter(value.padStart(2, '0') || '00')
    },
    []
  )

  if (!open) return null

  const isActive = timerState !== 'idle'
  const displayMinutes = isActive
    ? String(Math.floor(remainingMs / 60000)).padStart(2, '0')
    : minutes
  const displaySeconds = isActive
    ? String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')
    : seconds

  return (
    <div
      ref={popoverRef}
      className="fixed z-[100] bg-[#141414] border border-white/10 rounded-xl shadow-xl p-4 flex flex-col gap-4"
      style={{
        top,
        left,
        transform: 'translateY(-50%)',
        fontFamily: 'var(--font-ui)',
        width: 160
      }}
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={displayMinutes}
          onChange={(e) => handleTimeInput(e.target.value, setMinutes, 99)}
          onBlur={() => handleBlur(minutes, setMinutes)}
          onFocus={(e) => e.target.select()}
          readOnly={isActive}
          className={`flex-1 min-w-0 h-10 bg-white/5 border border-white/10 rounded-lg text-center text-lg text-white font-medium focus:outline-none transition-colors ${
            isActive ? 'cursor-default opacity-80' : 'focus:border-white/30'
          }`}
          aria-label="Minutes"
        />
        <span className="text-lg text-gray-400 font-medium select-none">:</span>
        <input
          type="text"
          inputMode="numeric"
          value={displaySeconds}
          onChange={(e) => handleTimeInput(e.target.value, setSeconds, 59)}
          onBlur={() => handleBlur(seconds, setSeconds)}
          onFocus={(e) => e.target.select()}
          readOnly={isActive}
          className={`flex-1 min-w-0 h-10 bg-white/5 border border-white/10 rounded-lg text-center text-lg text-white font-medium focus:outline-none transition-colors ${
            isActive ? 'cursor-default opacity-80' : 'focus:border-white/30'
          }`}
          aria-label="Seconds"
        />
      </div>

      <div className="flex items-center gap-2">
        {timerState === 'idle' && (
          <button
            type="button"
            onClick={startTimer}
            className="flex-1 flex items-center justify-center p-2.5 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors"
            aria-label="Start"
          >
            <PlayIcon className="w-5 h-5" />
          </button>
        )}

        {timerState === 'running' && (
          <>
            <button
              type="button"
              onClick={pauseTimer}
              className="flex-1 flex items-center justify-center p-2.5 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors"
              aria-label="Pause"
            >
              <PauseIcon className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={stopTimer}
              className="flex-1 flex items-center justify-center p-2.5 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors"
              aria-label="Stop"
            >
              <StopIcon className="w-5 h-5" />
            </button>
          </>
        )}

        {timerState === 'paused' && (
          <>
            <button
              type="button"
              onClick={resumeTimer}
              className="flex-1 flex items-center justify-center p-2.5 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors"
              aria-label="Resume"
            >
              <PlayIcon className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={stopTimer}
              className="flex-1 flex items-center justify-center p-2.5 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors"
              aria-label="Stop"
            >
              <StopIcon className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
