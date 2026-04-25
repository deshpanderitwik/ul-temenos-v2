import { useCallback, useEffect, useRef, useState } from 'react'
import { createNarrative, getLatestNarrativeId, onExternalChange } from '../lib/narrativeStore'
import NarrativeEditor from './NarrativeEditor'
import NarrativesList from './NarrativesList'
import AppModal from './AppModal'
import SideRail from './SideRail'

/**
 * Writing surface: full-bleed editor (centered column in CSS) with a fixed primary
 * rail that does not consume horizontal space. Modals are owned here.
 */
export default function WritingWorkspace() {
  const [narrativesModalOpen, setNarrativesModalOpen] = useState(false)
  const [activeNarrativeId, setActiveNarrativeId] = useState<string | null>(null)
  const [creatingNarrative, setCreatingNarrative] = useState(false)
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
      <SideRail
        onNewNarrative={() => void createNewNarrative()}
        creatingNarrative={creatingNarrative}
        onOpenNarratives={() => setNarrativesModalOpen(true)}
      />

      <main className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <NarrativeEditor
          activeNarrativeId={activeNarrativeId}
          onNarrativeIdAssigned={setActiveNarrativeId}
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
