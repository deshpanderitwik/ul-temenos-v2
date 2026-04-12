import { supabase } from './supabase'
import { hasLocalData, importNarratives } from './narrativeStore'

/**
 * One-time migration: if the local store is empty and Supabase has narratives,
 * pull them down and import. Works with the new schema (separate narratives +
 * drafts tables). Runs silently -- errors are swallowed since this is a
 * best-effort convenience for existing users.
 */
export async function migrateFromSupabaseIfNeeded(): Promise<void> {
  try {
    const hasData = await hasLocalData()
    if (hasData) return

    const email = import.meta.env.VITE_SUPABASE_USER_EMAIL
    const password = import.meta.env.VITE_SUPABASE_USER_PASSWORD
    if (!email || !password) return

    let { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return
    }

    const { data: narratives, error: nErr } = await supabase
      .from('narratives')
      .select('id, title, active_draft_id, tags, created_at, updated_at')
      .order('updated_at', { ascending: false })

    if (nErr || !narratives || narratives.length === 0) return

    const { data: drafts, error: dErr } = await supabase
      .from('drafts')
      .select('id, narrative_id, parent_draft_id, label, content, created_at, updated_at')

    if (dErr || !drafts) return

    const draftsByNarrative = new Map<string, typeof drafts>()
    for (const d of drafts) {
      const list = draftsByNarrative.get(d.narrative_id) ?? []
      list.push(d)
      draftsByNarrative.set(d.narrative_id, list)
    }

    const items = narratives.map((n) => {
      const nDrafts = draftsByNarrative.get(n.id) ?? []
      const activeDraft = nDrafts.find((d) => d.id === n.active_draft_id)
      return {
        id: n.id,
        title: n.title,
        content: activeDraft?.content ?? null,
        updated_at: n.updated_at
      }
    })

    await importNarratives(items)
  } catch {
    // Migration is best-effort -- never block the app.
  }
}
