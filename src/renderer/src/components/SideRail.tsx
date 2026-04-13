import { useCallback, useRef, useState } from 'react'
import { ClockIcon, PlusIcon, RectangleStackIcon } from '@heroicons/react/24/outline'
import TimerPopover from './TimerPopover'
import { PrimaryRail, PrimaryRailButton } from './PrimaryRail'

type SideRailProps = {
  onNewNarrative: () => void
  creatingNarrative: boolean
  onOpenNarratives: () => void
}

export default function SideRail({ onNewNarrative, creatingNarrative, onOpenNarratives }: SideRailProps) {
  const [timerOpen, setTimerOpen] = useState(false)
  const [timerProgress, setTimerProgress] = useState(0)
  const [timerActive, setTimerActive] = useState(false)
  const timerButtonRef = useRef<HTMLButtonElement>(null)

  const handleTimerStateChange = useCallback(
    (state: 'idle' | 'running' | 'paused', remaining: number, total: number) => {
      const active = state === 'running' || state === 'paused'
      setTimerActive(active)
      setTimerProgress(active && total > 0 ? remaining / total : 0)
    },
    []
  )

  return (
    <>
      <aside
        className="fixed left-5 top-1/2 z-30 -translate-y-1/2"
        aria-label="Primary tools"
      >
        <PrimaryRail timerProgress={timerProgress} timerActive={timerActive}>
          <PrimaryRailButton
            label="New narrative"
            disabled={creatingNarrative}
            onClick={onNewNarrative}
          >
            <PlusIcon strokeWidth={1.5} className="w-5 h-5" aria-hidden />
          </PrimaryRailButton>
          <PrimaryRailButton
            ref={timerButtonRef}
            label="Timer"
            onClick={() => setTimerOpen((o) => !o)}
          >
            <ClockIcon strokeWidth={1.5} className="w-5 h-5" aria-hidden />
          </PrimaryRailButton>
          <PrimaryRailButton label="Narratives" onClick={onOpenNarratives}>
            <RectangleStackIcon strokeWidth={1.5} className="w-5 h-5" aria-hidden />
          </PrimaryRailButton>
        </PrimaryRail>
      </aside>

      <TimerPopover
        open={timerOpen}
        onClose={() => setTimerOpen(false)}
        anchorRef={timerButtonRef}
        onTimerStateChange={handleTimerStateChange}
      />
    </>
  )
}
