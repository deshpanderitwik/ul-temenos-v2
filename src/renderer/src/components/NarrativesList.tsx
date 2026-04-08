import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type NarrativeRow = {
  id: string
  title: string | null
  updated_at: string
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

export type NarrativesListProps = {
  activeNarrativeId: string | null
  onPickNarrative: (id: string) => void
}

export default function NarrativesList({ activeNarrativeId, onPickNarrative }: NarrativesListProps) {
  const [rows, setRows] = useState<NarrativeRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('narratives')
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false })

      if (cancelled) return

      if (error) {
        setRows([])
      } else {
        setRows((data as NarrativeRow[]) ?? [])
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <p className="text-sm text-gray-400" role="status">
        Loading…
      </p>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No narratives yet. Use New narrative (+) or save the editor to create one.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => {
        const isActive = row.id === activeNarrativeId
        const label = row.title?.trim() || 'Untitled'

        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onPickNarrative(row.id)}
              className={`flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-4 text-left transition-all rounded-[12px] ${
                isActive
                  ? 'bg-[rgba(255,255,255,0.1)]'
                  : 'hover:bg-white/5'
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-base text-white">{label}</span>
              <span className="shrink-0 text-sm text-gray-400 tabular-nums">
                {formatUpdatedAt(row.updated_at)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
