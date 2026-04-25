import { useEffect, useRef, useCallback, memo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  AUTOSAVE_DEBOUNCE_MS,
  shouldTriggerMaxIntervalSave
} from '../lib/autosaveConfig'
import { deriveNarrativeTitleFromContent } from '../lib/deriveNarrativeTitle'
import { getNarrative, updateDraft } from '../lib/narrativeStore'
import {
  readAnchorSnapshot,
  readAnchorConfig,
  computeMidpoint,
  shouldAnchor,
  detectLineAdvance,
  applyAnchor,
  type AnchorConfig
} from '../lib/caretAnchor'

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

export default memo(function NarrativeEditor({
  activeNarrativeId,
  onNarrativeIdAssigned,
  reloadKey = 0
}: NarrativeEditorProps) {
  const loadGenerationRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastCaretYRef = useRef<number>(-1)
  const cachedAnchorConfigRef = useRef<AnchorConfig | null>(null)

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
      },
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

  const scrollEditorToTopAndFocusEnd = useCallback(() => {
    const container = scrollRef.current
    if (container) container.scrollTop = 0
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
    lastCaretYRef.current = -1
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
    lastCaretYRef.current = -1
    lastPersistTimeRef.current = Date.now()
    }

    loadDocumentForActiveId()
  }, [
    editor,
    activeNarrativeId,
    reloadKey,
    scrollEditorToTopAndFocusEnd,
    clearAutosaveDebounce
  ])

  useEffect(() => {
    if (!editor) return

    const handleDocumentUpdate = () => {
      const container = scrollRef.current

      if (container) {
        let config = cachedAnchorConfigRef.current
        if (!config) {
          config = readAnchorConfig(container)
          cachedAnchorConfigRef.current = config
        }
        const midpoint = computeMidpoint(container, config)

        const snapshot = readAnchorSnapshot(editor, container, config, midpoint)
        const lastAbsY = lastCaretYRef.current

        if (
          detectLineAdvance(snapshot, lastAbsY) &&
          snapshot.caretY > snapshot.midpoint &&
          shouldAnchor(snapshot)
        ) {
          applyAnchor(container, snapshot.caretY - snapshot.midpoint)
        }

        lastCaretYRef.current = snapshot.absY
      }

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

    editor.on('update', handleDocumentUpdate)

    return () => {
      editor.off('update', handleDocumentUpdate)
    }
  }, [editor, scheduleDebouncedAutosave, clearAutosaveDebounce])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const refreshAnchorCache = () => {
      cachedAnchorConfigRef.current = readAnchorConfig(container)
    }

    refreshAnchorCache()

    const resizeObserver = new ResizeObserver(refreshAnchorCache)
    resizeObserver.observe(container)
    const offsetParent = container.offsetParent
    if (offsetParent instanceof Element) {
      resizeObserver.observe(offsetParent)
    }

    window.addEventListener('resize', refreshAnchorCache)
    document.addEventListener('anchor:invalidate', refreshAnchorCache)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', refreshAnchorCache)
      document.removeEventListener('anchor:invalidate', refreshAnchorCache)
    }
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
})
