import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import { connectNarrative, type YjsConnection } from '../lib/yjsClient'
import { deriveNarrativeTitleFromContent } from '../lib/deriveNarrativeTitle'
import {
  readAnchorSnapshot,
  readAnchorConfig,
  computeMidpoint,
  shouldAnchor,
  detectLineAdvance,
  applyAnchor,
  type AnchorConfig
} from '../lib/caretAnchor'

const TITLE_DEBOUNCE_MS = 500

export type NarrativeEditorProps = {
  activeNarrativeId: string | null
  onNarrativeIdAssigned: (id: string) => void
  reloadKey?: number
}

export default function NarrativeEditor({
  activeNarrativeId,
  reloadKey = 0
}: NarrativeEditorProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastCaretYRef = useRef<number>(-1)
  const cachedAnchorConfigRef = useRef<AnchorConfig | null>(null)
  const [connection, setConnection] = useState<YjsConnection | null>(null)

  useEffect(() => {
    if (activeNarrativeId === null) {
      setConnection(null)
      return
    }

    let cancelled = false
    let conn: YjsConnection | null = null

    connectNarrative(activeNarrativeId).then(
      (c) => {
        if (cancelled) {
          c.dispose()
          return
        }
        conn = c
        setConnection(c)
      },
      (err) => {
        console.error('[yjs] connectNarrative failed', err)
      }
    )

    return () => {
      cancelled = true
      if (conn) conn.dispose()
      setConnection(null)
    }
  }, [activeNarrativeId, reloadKey])

  // Always include StarterKit + Placeholder so the schema has a valid top
  // node type ('doc') even on first render before the Yjs connection
  // resolves. The Collaboration extension joins once the Y.Doc is ready and
  // useEditor recreates the editor (deps: [connection]). Without StarterKit
  // present in the initial render, ProseMirror throws "Schema is missing
  // its top node type ('doc')".
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          orderedList: false,
          undoRedo: false
        }),
        Placeholder.configure({ placeholder: 'Start writing...' }),
        ...(connection
          ? [Collaboration.configure({ document: connection.doc })]
          : [])
      ],
      autofocus: 'end',
      editable: connection !== null,
      editorProps: {
        attributes: {
          class: 'focus:outline-none min-h-full'
        }
      }
    },
    [connection]
  )

  // Caret-anchor scroll behaviour: when the user advances to a new line and
  // the caret has moved past the viewport midpoint, scroll the editor down so
  // the caret stays near the centre. Ported verbatim from the legacy editor.
  useEffect(() => {
    if (!editor) return

    const handleDocumentUpdate = () => {
      const container = scrollRef.current
      if (!container) return
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

    editor.on('update', handleDocumentUpdate)
    return () => {
      editor.off('update', handleDocumentUpdate)
    }
  }, [editor])

  // Refresh anchor cache on container resize / window resize / explicit
  // anchor:invalidate event.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const refreshAnchorCache = () => {
      cachedAnchorConfigRef.current = readAnchorConfig(container)
    }
    refreshAnchorCache()

    const ro = new ResizeObserver(refreshAnchorCache)
    ro.observe(container)
    const offsetParent = container.offsetParent
    if (offsetParent instanceof Element) ro.observe(offsetParent)
    window.addEventListener('resize', refreshAnchorCache)
    document.addEventListener('anchor:invalidate', refreshAnchorCache)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', refreshAnchorCache)
      document.removeEventListener('anchor:invalidate', refreshAnchorCache)
    }
  }, [])

  // Debounced title derivation.
  useEffect(() => {
    if (!editor || !activeNarrativeId) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let lastTitle: string | null = null

    const onUpdate = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const json = editor.getJSON()
        const derived = deriveNarrativeTitleFromContent(json) ?? 'Untitled'
        if (derived === lastTitle) return
        lastTitle = derived
        void window.api.yjs
          .updateMeta(activeNarrativeId, { title: derived })
          .catch((err) => {
            console.error('[yjs] updateMeta(title) failed', err)
          })
      }, TITLE_DEBOUNCE_MS)
    }

    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
      if (timer) clearTimeout(timer)
    }
  }, [editor, activeNarrativeId])

  // Reset caret anchor's last-y on narrative switch so we don't carry stale
  // pixel positions across documents.
  useEffect(() => {
    lastCaretYRef.current = -1
  }, [activeNarrativeId])

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
