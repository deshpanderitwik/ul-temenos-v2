import { useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { deriveNarrativeTitleFromContent } from '../lib/deriveNarrativeTitle'
import { supabase } from '../lib/supabase'

export type NarrativeEditorProps = {
  activeNarrativeId: string | null
  onNarrativeIdAssigned: (id: string) => void
}

export default function NarrativeEditor({
  activeNarrativeId,
  onNarrativeIdAssigned
}: NarrativeEditorProps) {
  const loadGenerationRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const suspendUntilRef = useRef(0)
  const programmaticScrollRef = useRef(false)

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

      // Keep behavior supportive: nudge only when caret falls below the anchor zone.
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

  const scheduleAnchor = useCallback((force = false) => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
    }

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      adjustCaretToAnchor(force)
    })
  }, [adjustCaretToAnchor])

  /**
   * After load: viewport at top (inherited scrollTop is wrong), selection at document end.
   * Briefly suspend caret anchoring so a forced anchor pass does not scroll down to the caret.
   */
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

  const save = useCallback(async () => {
    if (!editor) return

    const content = editor.getJSON()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const title = deriveNarrativeTitleFromContent(content) ?? 'Untitled'

    if (activeNarrativeId) {
      await supabase.from('narratives').update({ content, title }).eq('id', activeNarrativeId)
    } else {
      const { data } = await supabase
        .from('narratives')
        .insert({ user_id: user.id, title, content })
        .select('id')
        .single()

      if (data?.id) onNarrativeIdAssigned(data.id)
    }
  }, [editor, activeNarrativeId, onNarrativeIdAssigned])

  useEffect(() => {
    if (!editor) return

    const generation = ++loadGenerationRef.current

    async function loadDocumentForActiveId() {
      if (activeNarrativeId === null) {
        editor.commands.setContent('')
        scrollEditorToTopAndFocusEnd()
        scheduleAnchor(false)
        return
      }

      const { data } = await supabase
        .from('narratives')
        .select('content')
        .eq('id', activeNarrativeId)
        .maybeSingle()

      if (generation !== loadGenerationRef.current) return

      if (data?.content != null) {
        editor.commands.setContent(data.content)
      } else {
        editor.commands.setContent('')
      }

      scrollEditorToTopAndFocusEnd()
      scheduleAnchor(false)
    }

    loadDocumentForActiveId()
  }, [editor, activeNarrativeId, scheduleAnchor, scrollEditorToTopAndFocusEnd])

  useEffect(() => {
    if (!editor) return

    const handleUpdate = () => {
      suspendUntilRef.current = 0
      scheduleAnchor(true)
    }

    const handleSelectionUpdate = () => {
      scheduleAnchor(false)
    }

    editor.on('update', handleUpdate)
    editor.on('selectionUpdate', handleSelectionUpdate)

    // Load effect positions scroll/selection; avoid a forced anchor here fighting that.
    scheduleAnchor(false)

    return () => {
      editor.off('update', handleUpdate)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, scheduleAnchor])

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

  // Cmd+S to save
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [save])

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  return (
    <div className="editor-scroll h-full w-full" ref={scrollRef}>
      <div className="editor-container">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
