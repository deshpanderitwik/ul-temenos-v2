import { useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  AUTOSAVE_DEBOUNCE_MS,
  shouldTriggerMaxIntervalSave
} from '../lib/autosaveConfig'
import { deriveNarrativeTitleFromContent } from '../lib/deriveNarrativeTitle'
import { getNarrative, updateDraft } from '../lib/narrativeStore'

export type NarrativeEditorProps = {
  activeNarrativeId: string | null
  onNarrativeIdAssigned: (id: string) => void
  reloadKey?: number
}

type PersistReason =
  | 'debounced'
  | 'manual'
  | 'max-interval'
  | 'visibility'
  | 'pagehide'
  | 'flush-after'

function isImmediateFlushReason(r: PersistReason): boolean {
  return r === 'manual' || r === 'visibility' || r === 'pagehide' || r === 'flush-after'
}

export default function NarrativeEditor({
  activeNarrativeId,
  onNarrativeIdAssigned,
  reloadKey = 0
}: NarrativeEditorProps) {
  const loadGenerationRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const suspendUntilRef = useRef(0)
  const programmaticScrollRef = useRef(false)

  const activeNarrativeIdRef = useRef(activeNarrativeId)
  activeNarrativeIdRef.current = activeNarrativeId
  const onNarrativeIdAssignedRef = useRef(onNarrativeIdAssigned)
  onNarrativeIdAssignedRef.current = onNarrativeIdAssigned

  const autosaveEpochRef = useRef(0)
  const autosaveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPersistTimeRef = useRef(Date.now())
  const inFlightRef = useRef(false)
  const flushAfterFlightRef = useRef(false)
  const dirtyDuringFlightRef = useRef(false)
  const persistGenerationRef = useRef(0)

  const runPersistRef = useRef<(reason: PersistReason, epochAtSchedule: number) => Promise<void>>(
    async () => {}
  )

  const clearAutosaveDebounce = useCallback(() => {
    if (autosaveDebounceTimerRef.current) {
      window.clearTimeout(autosaveDebounceTimerRef.current)
      autosaveDebounceTimerRef.current = null
    }
  }, [])

  const scheduleDebouncedAutosave = useCallback(() => {
    const epoch = autosaveEpochRef.current
    clearAutosaveDebounce()
    autosaveDebounceTimerRef.current = window.setTimeout(() => {
      autosaveDebounceTimerRef.current = null
      void runPersistRef.current('debounced', epoch)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [clearAutosaveDebounce])

  const flushPendingPersist = useCallback(() => {
    clearAutosaveDebounce()
    void runPersistRef.current('manual', autosaveEpochRef.current)
  }, [clearAutosaveDebounce])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start writing...'
      })
    ],
    autofocus: true,
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-full'
      }
    }
  })

  const runPersist = useCallback(
    async (reason: PersistReason, epochAtSchedule: number) => {
      const ed = editor
      if (!ed) return
      if (epochAtSchedule !== autosaveEpochRef.current) return

      if (inFlightRef.current) {
        if (isImmediateFlushReason(reason)) {
          flushAfterFlightRef.current = true
        }
        dirtyDuringFlightRef.current = true
        return
      }

      const id = activeNarrativeIdRef.current
      if (!id) return

      const jsonSnapshot = JSON.stringify(ed.getJSON())
      const narrativeEpochAtFlightStart = autosaveEpochRef.current
      persistGenerationRef.current += 1
      const generationAtStart = persistGenerationRef.current

      inFlightRef.current = true
      dirtyDuringFlightRef.current = false
      let didPersist = false

      try {
        const content = ed.getJSON()

        if (autosaveEpochRef.current !== narrativeEpochAtFlightStart) return
        if (persistGenerationRef.current !== generationAtStart) return

        const title = deriveNarrativeTitleFromContent(content) ?? 'Untitled'
        await updateDraft(id, content, title)

        didPersist = true
        lastPersistTimeRef.current = Date.now()
      } finally {
        inFlightRef.current = false
      }

      if (!didPersist) return
      if (autosaveEpochRef.current !== narrativeEpochAtFlightStart) return
      if (persistGenerationRef.current !== generationAtStart) return

      const jsonNow = JSON.stringify(ed.getJSON())
      const docChangedDuringFlight =
        jsonNow !== jsonSnapshot || dirtyDuringFlightRef.current

      if (flushAfterFlightRef.current) {
        flushAfterFlightRef.current = false
        dirtyDuringFlightRef.current = false
        void runPersist('flush-after', autosaveEpochRef.current)
        return
      }

      if (docChangedDuringFlight) {
        dirtyDuringFlightRef.current = false
        scheduleDebouncedAutosave()
      }
    },
    [editor, scheduleDebouncedAutosave]
  )

  runPersistRef.current = runPersist

  const adjustCaretToAnchor = useCallback((force = false) => {
    if (!editor) return

    const container = scrollRef.current
    if (!container) return

    if (!force && Date.now() < suspendUntilRef.current) return

    const styles = getComputedStyle(container)
    const anchorRatio = Number.parseFloat(styles.getPropertyValue('--editor-anchor-ratio')) || 0.5
    const deadZone = Number.parseFloat(styles.getPropertyValue('--editor-anchor-dead-zone')) || 24

    try {
      const caret = editor.view.coordsAtPos(editor.state.selection.from)
      const containerRect = container.getBoundingClientRect()
      const caretY = caret.top - containerRect.top + container.scrollTop
      const targetY = container.scrollTop + container.clientHeight * anchorRatio
      const drift = caretY - targetY

      if (drift <= deadZone) return

      const maxScrollTop = container.scrollHeight - container.clientHeight
      const nextScrollTop = Math.min(maxScrollTop, container.scrollTop + drift - deadZone)
      if (nextScrollTop <= container.scrollTop) return

      programmaticScrollRef.current = true
      container.scrollTop = nextScrollTop

      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    } catch {
      // Selection can be transiently invalid during document updates.
    }
  }, [editor])

  const scheduleAnchor = useCallback(
    (force = false) => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current)
      }

      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null
        adjustCaretToAnchor(force)
      })
    },
    [adjustCaretToAnchor]
  )

  const scrollEditorToTopAndFocusEnd = useCallback(() => {
    const container = scrollRef.current
    if (container) container.scrollTop = 0
    suspendUntilRef.current = Date.now() + 2500
    editor?.commands.focus('end')
    window.requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = 0
      window.requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0
      })
    })
  }, [editor])

  useEffect(() => {
    if (!editor) return

    const generation = ++loadGenerationRef.current
    autosaveEpochRef.current += 1
    clearAutosaveDebounce()
    flushAfterFlightRef.current = false
    dirtyDuringFlightRef.current = false

    async function loadDocumentForActiveId() {
      if (activeNarrativeId === null) {
        editor.commands.setContent('')
        scrollEditorToTopAndFocusEnd()
        scheduleAnchor(false)
        lastPersistTimeRef.current = Date.now()
        return
      }

      const narrative = await getNarrative(activeNarrativeId)

      if (generation !== loadGenerationRef.current) return

      if (narrative?.content != null) {
        editor.commands.setContent(narrative.content)
      } else {
        editor.commands.setContent('')
      }

      scrollEditorToTopAndFocusEnd()
      scheduleAnchor(false)
      lastPersistTimeRef.current = Date.now()
    }

    loadDocumentForActiveId()
  }, [
    editor,
    activeNarrativeId,
    reloadKey,
    scheduleAnchor,
    scrollEditorToTopAndFocusEnd,
    clearAutosaveDebounce
  ])

  useEffect(() => {
    if (!editor) return

    const handleDocumentUpdate = () => {
      suspendUntilRef.current = 0
      scheduleAnchor(true)

      if (inFlightRef.current) {
        dirtyDuringFlightRef.current = true
        return
      }

      const epoch = autosaveEpochRef.current
      if (shouldTriggerMaxIntervalSave(lastPersistTimeRef.current, Date.now())) {
        clearAutosaveDebounce()
        void runPersistRef.current('max-interval', epoch)
      } else {
        scheduleDebouncedAutosave()
      }
    }

    const handleSelectionUpdate = () => {
      scheduleAnchor(false)
    }

    editor.on('update', handleDocumentUpdate)
    editor.on('selectionUpdate', handleSelectionUpdate)

    scheduleAnchor(false)

    return () => {
      editor.off('update', handleDocumentUpdate)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, scheduleAnchor, scheduleDebouncedAutosave, clearAutosaveDebounce])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    function handleScroll() {
      if (programmaticScrollRef.current) return
      suspendUntilRef.current = Date.now() + 1200
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        clearAutosaveDebounce()
        void runPersistRef.current('visibility', autosaveEpochRef.current)
      }
    }

    function onPageHide() {
      clearAutosaveDebounce()
      void runPersistRef.current('pagehide', autosaveEpochRef.current)
    }

    function onBeforeUnload() {
      clearAutosaveDebounce()
      void runPersistRef.current('pagehide', autosaveEpochRef.current)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [clearAutosaveDebounce])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        flushPendingPersist()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flushPendingPersist])

  useEffect(() => {
    return () => {
      clearAutosaveDebounce()
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current)
      }
    }
  }, [clearAutosaveDebounce])

  const handleEditorChromePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!editor) return
      const scroll = scrollRef.current
      if (!scroll) return
      const proseMirror = scroll.querySelector('.ProseMirror')
      if (!proseMirror) return
      const target = e.target
      if (target instanceof Node && proseMirror.contains(target)) return

      e.preventDefault()
      editor.chain().focus('end').run()
    },
    [editor]
  )

  return (
    <div
      className="editor-scroll h-full w-full"
      ref={scrollRef}
      onPointerDown={handleEditorChromePointerDown}
    >
      <div className="editor-container">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
