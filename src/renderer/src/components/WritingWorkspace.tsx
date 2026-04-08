import { useCallback, useEffect, useRef, useState } from 'react'
import { ClockIcon, PlusIcon, RectangleStackIcon } from '@heroicons/react/24/outline'
import { EMPTY_NARRATIVE_CONTENT } from '../lib/emptyNarrativeContent'
import { supabase } from '../lib/supabase'
import NarrativeEditor from './NarrativeEditor'
import NarrativesList from './NarrativesList'
import AppModal from './AppModal'
import { PrimaryRail, PrimaryRailButton } from './PrimaryRail'

/**
 * Writing surface: full-bleed editor (centered column in CSS) with a fixed primary
 * rail that does not consume horizontal space. Modals are owned here.
 */
export default function WritingWorkspace() {
  const [narrativesModalOpen, setNarrativesModalOpen] = useState(false)
  const [activeNarrativeId, setActiveNarrativeId] = useState<string | null>(null)
  const [creatingNarrative, setCreatingNarrative] = useState(false)
  const creatingLockRef = useRef(false)

  const createNewNarrative = useCallback(async () => {
    if (creatingLockRef.current) return
    creatingLockRef.current = true
    setCreatingNarrative(true)

    try {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('narratives')
        .insert({
          user_id: user.id,
          title: 'Untitled',
          content: EMPTY_NARRATIVE_CONTENT
        })
        .select('id')
        .single()

      if (error || !data?.id) return

      setNarrativesModalOpen(false)
      setActiveNarrativeId(data.id)
    } finally {
      creatingLockRef.current = false
      setCreatingNarrative(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrapLatestNarrative() {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const { data } = await supabase
        .from('narratives')
        .select('id')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!cancelled && data?.id) setActiveNarrativeId(data.id)
    }

    bootstrapLatestNarrative()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="relative h-full min-h-0 w-full min-w-0">
      <aside
        className="fixed left-5 top-1/2 z-30 -translate-y-1/2"
        aria-label="Primary tools"
      >
        <PrimaryRail>
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
            label="History"
            onClick={() => {
              /* wire when history exists */
            }}
          >
            <ClockIcon strokeWidth={1.5} className="w-5 h-5" aria-hidden />
          </PrimaryRailButton>
          <PrimaryRailButton label="Narratives" onClick={() => setNarrativesModalOpen(true)}>
            <RectangleStackIcon strokeWidth={1.5} className="w-5 h-5" aria-hidden />
          </PrimaryRailButton>
        </PrimaryRail>
      </aside>

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
      >
        <NarrativesList
          activeNarrativeId={activeNarrativeId}
          onPickNarrative={(id) => {
            setActiveNarrativeId(id)
            setNarrativesModalOpen(false)
          }}
        />
      </AppModal>
    </div>
  )
}
