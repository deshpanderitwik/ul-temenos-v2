import { ensureAuthenticated } from './supabaseMain'
import * as store from './store'
import type { NarrativeMeta, Draft } from './store'
import { existsSync } from 'node:fs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SYNC_INTERVAL_MS = 60_000
const PUSH_DEBOUNCE_MS = 3_000

let syncTimer: ReturnType<typeof setInterval> | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
const pendingPushes = new Set<string>()
let syncing = false

// ── Helpers ──

function narrativeMetaPath(id: string): string {
  return join(store.getStoreDir(), 'narratives', id, 'narrative.json')
}

function draftPath(narrativeId: string, draftId: string): string {
  return join(store.getStoreDir(), 'narratives', narrativeId, 'drafts', `${draftId}.json`)
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

// ── Push: local → remote ──

async function pushNarrative(narrativeId: string): Promise<void> {
  const sb = await ensureAuthenticated()
  if (!sb) return

  const meta = readJson<NarrativeMeta>(narrativeMetaPath(narrativeId))
  if (!meta) return

  const { data: { user } } = await sb.auth.getUser()
  if (!user) return

  // Break the FK cycle between narratives.active_draft_id and drafts.narrative_id:
  // upsert the narrative row first with active_draft_id null, then the draft, then
  // patch active_draft_id. A straight upsert with active_draft_id set fails with
  // narratives_active_draft_id_fkey when the draft doesn't yet exist remotely.
  const { error: narrativeError } = await sb.from('narratives').upsert({
    id: meta.id,
    user_id: user.id,
    title: meta.title,
    active_draft_id: null,
    tags: meta.tags,
    created_at: meta.createdAt,
    updated_at: meta.updatedAt
  }, { onConflict: 'id' })

  if (narrativeError) {
    console.error('[sync] pushNarrative: narrative upsert failed', narrativeError)
    return
  }

  const dp = draftPath(narrativeId, meta.activeDraftId)
  const draft = readJson<Draft>(dp)
  if (!draft) return

  const { error: draftError } = await sb.from('drafts').upsert({
    id: draft.id,
    narrative_id: draft.narrativeId,
    parent_draft_id: draft.parentDraftId,
    label: draft.label,
    content: draft.content,
    created_at: draft.createdAt,
    updated_at: draft.updatedAt
  }, { onConflict: 'id' })

  if (draftError) {
    console.error('[sync] pushNarrative: draft upsert failed', draftError)
    return
  }

  const { error: linkError } = await sb
    .from('narratives')
    .update({ active_draft_id: meta.activeDraftId })
    .eq('id', meta.id)

  if (linkError) {
    console.error('[sync] pushNarrative: active_draft_id link failed', linkError)
  }
}

async function pushDelete(narrativeId: string): Promise<void> {
  const sb = await ensureAuthenticated()
  if (!sb) return

  await sb.from('narratives').delete().eq('id', narrativeId)
}

function flushPendingPushes(): void {
  if (pendingPushes.size === 0) return

  const ids = [...pendingPushes]
  pendingPushes.clear()

  for (const id of ids) {
    pushNarrative(id).catch(() => {})
  }
}

// ── Pull: remote → local ──

async function pullFromRemote(): Promise<void> {
  const sb = await ensureAuthenticated()
  if (!sb) return

  const { data: remoteNarratives, error: nErr } = await sb
    .from('narratives')
    .select('id, title, active_draft_id, tags, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (nErr || !remoteNarratives) return

  const { data: remoteDrafts, error: dErr } = await sb
    .from('drafts')
    .select('id, narrative_id, parent_draft_id, label, content, created_at, updated_at')

  if (dErr || !remoteDrafts) return

  const draftsByNarrative = new Map<string, typeof remoteDrafts>()
  for (const d of remoteDrafts) {
    const list = draftsByNarrative.get(d.narrative_id) ?? []
    list.push(d)
    draftsByNarrative.set(d.narrative_id, list)
  }

  for (const rn of remoteNarratives) {
    const localMeta = readJson<NarrativeMeta>(narrativeMetaPath(rn.id))

    if (!localMeta) {
      const drafts = draftsByNarrative.get(rn.id) ?? []
      store.importFromRemote({
        id: rn.id,
        title: rn.title,
        activeDraftId: rn.active_draft_id,
        tags: rn.tags ?? [],
        createdAt: rn.created_at,
        updatedAt: rn.updated_at,
        drafts: drafts.map((d) => ({
          id: d.id,
          narrativeId: d.narrative_id,
          parentDraftId: d.parent_draft_id,
          label: d.label,
          content: d.content,
          createdAt: d.created_at,
          updatedAt: d.updated_at
        }))
      })
      continue
    }

    const remoteTime = new Date(rn.updated_at).getTime()
    const localTime = new Date(localMeta.updatedAt).getTime()

    if (remoteTime > localTime) {
      const drafts = draftsByNarrative.get(rn.id) ?? []
      store.importFromRemote({
        id: rn.id,
        title: rn.title,
        activeDraftId: rn.active_draft_id,
        tags: rn.tags ?? [],
        createdAt: rn.created_at,
        updatedAt: rn.updated_at,
        drafts: drafts.map((d) => ({
          id: d.id,
          narrativeId: d.narrative_id,
          parentDraftId: d.parent_draft_id,
          label: d.label,
          content: d.content,
          createdAt: d.created_at,
          updatedAt: d.updated_at
        }))
      })
    } else if (localTime > remoteTime) {
      // Local is newer than remote — a previous push must have failed silently
      // (FK error, network blip, etc.). Re-enqueue so it gets pushed this cycle.
      pushNarrative(rn.id).catch(() => {})
    }
  }

  // Push any local narratives that don't exist remotely
  const remoteIds = new Set(remoteNarratives.map((n) => n.id))
  const localEntries = store.listNarratives()
  for (const local of localEntries) {
    if (!remoteIds.has(local.id)) {
      pushNarrative(local.id).catch(() => {})
    }
  }
}

// ── Full sync cycle ──

async function syncCycle(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await pullFromRemote()
    flushPendingPushes()
  } catch {
    // Sync failures are non-fatal
  } finally {
    syncing = false
  }
}

// ── Public API ──

export function schedulePush(narrativeId: string): void {
  pendingPushes.add(narrativeId)
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    flushPendingPushes()
  }, PUSH_DEBOUNCE_MS)
}

export function schedulePushDelete(narrativeId: string): void {
  pendingPushes.delete(narrativeId)
  pushDelete(narrativeId).catch(() => {})
}

export function startSync(): void {
  syncCycle().catch(() => {})
  syncTimer = setInterval(() => {
    syncCycle().catch(() => {})
  }, SYNC_INTERVAL_MS)
}

export function stopSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  flushPendingPushes()
}

export function syncNow(): void {
  syncCycle().catch(() => {})
}
