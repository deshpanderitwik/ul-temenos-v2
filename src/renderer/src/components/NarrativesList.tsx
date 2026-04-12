import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, TrashIcon } from '@heroicons/react/24/outline'
import { listNarratives, deleteNarrative } from '../lib/narrativeStore'
import type { NarrativeIndexEntry } from '../lib/narrativeStore'

export type NarrativesListProps = {
  activeNarrativeId: string | null
  onPickNarrative: (id: string) => void
  onNarrativeDeleted?: (id: string) => void
}

export default function NarrativesList({
  activeNarrativeId,
  onPickNarrative,
  onNarrativeDeleted
}: NarrativesListProps) {
  const [rows, setRows] = useState<NarrativeIndexEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const data = await listNarratives()
        if (!cancelled) setRows(data)
      } catch {
        if (!cancelled) setRows([])
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      if (deletingId) return
      setDeletingId(id)
      try {
        await deleteNarrative(id)
        setRows((prev) => prev.filter((r) => r.id !== id))
        onNarrativeDeleted?.(id)
      } finally {
        setDeletingId(null)
        setConfirmDeleteId((c) => (c === id ? null : c))
      }
    },
    [deletingId, onNarrativeDeleted]
  )

  useEffect(() => {
    if (!confirmDeleteId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDeleteId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDeleteId])

  useEffect(() => {
    if (!confirmDeleteId) return
    const onFocusIn = (e: FocusEvent) => {
      const rowEl = document.querySelector(`[data-narrative-row="${confirmDeleteId}"]`)
      if (!rowEl) {
        setConfirmDeleteId(null)
        return
      }
      const target = e.target as Node | null
      if (target && !rowEl.contains(target)) setConfirmDeleteId(null)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [confirmDeleteId])

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
        const isDeleting = deletingId === row.id
        const isArmed = confirmDeleteId === row.id

        return (
          <li
            key={row.id}
            data-narrative-row={row.id}
            className={`group flex min-h-[56px] items-stretch rounded-[12px] transition-colors ${
              isActive ? 'bg-[rgba(255,255,255,0.1)]' : 'hover:bg-white/5'
            }`}
            onMouseLeave={() => {
              if (isArmed && !isDeleting) setConfirmDeleteId(null)
            }}
          >
            <button
              type="button"
              onClick={() => {
                setConfirmDeleteId(null)
                onPickNarrative(row.id)
              }}
              disabled={isDeleting}
              className="flex min-w-0 flex-1 cursor-pointer items-center px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="min-w-0 flex-1 truncate text-base text-white">{label}</span>
            </button>
            <div className="flex shrink-0 items-center pr-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (isDeleting) return
                  if (isArmed) {
                    void handleDelete(row.id)
                  } else {
                    setConfirmDeleteId(row.id)
                  }
                }}
                disabled={isDeleting}
                className={`shrink-0 p-2 rounded transition-all disabled:pointer-events-none disabled:opacity-40 ${
                  isArmed
                    ? 'opacity-100 text-red-400 hover:text-red-300 hover:bg-red-500/10'
                    : 'text-gray-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white hover:bg-white/10'
                }`}
                aria-label={
                  isArmed
                    ? `Confirm delete narrative: ${label}`
                    : `Delete narrative: ${label}`
                }
                title={isArmed ? 'Confirm delete' : 'Delete'}
              >
                <span className="relative block h-5 w-5">
                  <TrashIcon
                    strokeWidth={1.5}
                    className={`pointer-events-none absolute inset-0 h-5 w-5 transition-opacity duration-200 ${
                      isArmed ? 'opacity-0' : 'opacity-100'
                    }`}
                    aria-hidden
                  />
                  <CheckIcon
                    strokeWidth={1.5}
                    className={`pointer-events-none absolute inset-0 h-5 w-5 transition-opacity duration-200 ${
                      isArmed ? 'opacity-100' : 'opacity-0'
                    }`}
                    aria-hidden
                  />
                </span>
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
