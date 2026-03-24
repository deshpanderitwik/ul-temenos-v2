import { useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { supabase } from '../lib/supabase'

export default function NarrativeEditor() {
  const narrativeId = useRef<string | null>(null)

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

  const save = useCallback(async () => {
    if (!editor) return

    const content = editor.getJSON()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    if (narrativeId.current) {
      await supabase
        .from('narratives')
        .update({ content })
        .eq('id', narrativeId.current)
    } else {
      const { data } = await supabase
        .from('narratives')
        .insert({ user_id: user.id, title: 'Untitled', content })
        .select('id')
        .single()

      if (data) narrativeId.current = data.id
    }
  }, [editor])

  // Load on mount
  useEffect(() => {
    if (!editor) return

    async function load() {
      const { data } = await supabase
        .from('narratives')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data) {
        narrativeId.current = data.id
        editor.commands.setContent(data.content)
      }
    }

    load()
  }, [editor])

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

  return (
    <div className="editor-scroll">
      <div className="editor-container">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
