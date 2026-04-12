import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClockIcon, PlusIcon, RectangleStackIcon } from '@heroicons/react/24/outline'
import { createNarrative, getLatestNarrativeId, onExternalChange } from '../lib/narrativeStore'
import NarrativeEditor from './NarrativeEditor'
import NarrativesList from './NarrativesList'
import AppModal from './AppModal'
import TimerPopover from './TimerPopover'
import { PrimaryRail, PrimaryRailButton } from './PrimaryRail'

/**
 * Writing surface: full-bleed editor (centered column in CSS) with a fixed primary
 * rail that does not consume horizontal space. Modals are owned here.
 */
export default function WritingWorkspace() {
  const [narrativesModalOpen, setNarrativesModalOpen] = useState(false)
  const [activeNarrativeId, setActiveNarrativeId] = useState<string | null>(null)
  const [creatingNarrative, setCreatingNarrative] = useState(false)
  const [editorReloadKey, setEditorReloadKey] = useState(0)
  const [timerOpen, setTimerOpen] = useState(false)
  const [timerProgress, setTimerProgress] = useState(0)
  const [timerActive, setTimerActive] = useState(false)
  const timerButtonRef = useRef<HTMLButtonElement>(null)
  const creatingLockRef = useRef(false)
  const activeNarrativeIdRef = useRef(activeNarrativeId)
  activeNarrativeIdRef.current = activeNarrativeId

  const createNewNarrative = useCallback(async () => {
    if (creatingLockRef.current) return
    creatingLockRef.current = true
    setCreatingNarrative(true)

    try {
      const { narrativeId } = await createNarrative()
      setNarrativesModalOpen(false)
      setActiveNarrativeId(narrativeId)
    } finally {
      creatingLockRef.current = false
      setCreatingNarrative(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrapLatestNarrative() {
      const id = await getLatestNarrativeId()
      if (!cancelled && id) setActiveNarrativeId(id)
    }

    bootstrapLatestNarrative()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return onExternalChange(({ filename }) => {
      if (!filename) return

      const parts = filename.split('/')
      const narrativeId = parts[1] ?? null

      if (narrativeId && narrativeId === activeNarrativeIdRef.current) {
        setEditorReloadKey((k) => k + 1)
      }

      if (!activeNarrativeIdRef.current && narrativeId) {
        void (async () => {
          const id = await getLatestNarrativeId()
          if (id) setActiveNarrativeId(id)
        })()
      }
    })
  }, [])

  return (
    <div className="relative h-full min-h-0 w-full min-w-0">
      <aside
        className="fixed left-5 top-1/2 z-30 -translate-y-1/2"
        aria-label="Primary tools"
      >
        <PrimaryRail timerProgress={timerProgress} timerActive={timerActive}>
          <PrimaryRailButton
            label="New narrative"
            disabled={creatingNarrative}
            onClick={() => {
              void createNewNarrative()
            }}
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
          <PrimaryRailButton label="Narratives" onClick={() => setNarrativesModalOpen(true)}>
            <RectangleStackIcon strokeWidth={1.5} className="w-5 h-5" aria-hidden />
          </PrimaryRailButton>
        </PrimaryRail>
      </aside>

      <TimerPopover
        open={timerOpen}
        onClose={() => setTimerOpen(false)}
        anchorRef={timerButtonRef}
        onTimerStateChange={useCallback((state: 'idle' | 'running' | 'paused', remaining: number, total: number) => {
          const active = state === 'running' || state === 'paused'
          setTimerActive(active)
          setTimerProgress(active && total > 0 ? remaining / total : 0)
        }, [])}
      />

      <main className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <NarrativeEditor
          activeNarrativeId={activeNarrativeId}
          onNarrativeIdAssigned={setActiveNarrativeId}
          reloadKey={editorReloadKey}
        />
      </main>

      <AppModal
        open={narrativesModalOpen}
        onClose={() => setNarrativesModalOpen(false)}
        title="Narratives"
        alignHeaderWithListBody
      >
        <NarrativesList
          activeNarrativeId={activeNarrativeId}
          onPickNarrative={(id) => {
            setActiveNarrativeId(id)
            setNarrativesModalOpen(false)
          }}
          onNarrativeDeleted={(deletedId) => {
            if (activeNarrativeId !== deletedId) return
            void (async () => {
              const id = await getLatestNarrativeId()
              setActiveNarrativeId(id)
            })()
          }}
        />
      </AppModal>
    </div>
  )
}
