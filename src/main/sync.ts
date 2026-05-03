import { BrowserWindow } from 'electron'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureAuthenticated } from './supabaseMain'
import {
  listNarratives,
  getNarrative,
  createNarrative,
  getUpdatesSince,
  setSyncState,
  getSyncState,
  applyRemoteUpdate
} from './yjs/persistence'

const SYNC_INTERVAL_MS = 60_000
const PUSH_DEBOUNCE_MS = 3_000

let syncTimer: ReturnType<typeof setInterval> | null = null
const pendingPushes = new Map<string, ReturnType<typeof setTimeout>>()
let syncing = false

// ── Encoding helpers (Yjs binary <-> base64 over the wire) ──

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'))
}

// ── Push: local → remote ──

async function ensureRemoteNarrative(
  sb: SupabaseClient,
  userId: string,
  narrativeId: string
): Promise<boolean> {
  const meta = getNarrative(narrativeId)
  if (!meta) return false
  const { error } = await sb.from('narratives').upsert(
    {
      id: meta.id,
      user_id: userId,
      title: meta.title,
      tags: meta.tags,
      created_at: meta.createdAt,
      updated_at: meta.updatedAt
    },
    { onConflict: 'id' }
  )
  if (error) {
    console.error('[sync] ensureRemoteNarrative failed', error.message)
    return false
  }
  return true
}

async function pushOne(narrativeId: string): Promise<void> {
  const sb = await ensureAuthenticated()
  if (!sb) return

  const { lastPushedSeq } = getSyncState(narrativeId)
  const updates = getUpdatesSince(narrativeId, lastPushedSeq)
  if (updates.length === 0) return

  const {
    data: { user }
  } = await sb.auth.getUser()
  if (!user) return

  const ok = await ensureRemoteNarrative(sb, user.id, narrativeId)
  if (!ok) return

  // Insert one row per update. Future optimization: batch insert.
  for (const u of updates) {
    const { error } = await sb.from('narrative_updates').insert({
      narrative_id: narrativeId,
      update_blob: bytesToBase64(u.update)
    })
    if (error) {
      console.error('[sync] push update failed for', narrativeId, error.message)
      return
    }
  }

  const lastSeq = updates[updates.length - 1].seq
  setSyncState(narrativeId, { lastPushedSeq: lastSeq })
}

async function pushDelete(narrativeId: string): Promise<void> {
  const sb = await ensureAuthenticated()
  if (!sb) return
  const { error } = await sb.from('narratives').delete().eq('id', narrativeId)
  if (error) console.error('[sync] pushDelete failed', error.message)
  // narrative_updates rows cascade via FK
}

// ── Pull: remote → local ──

function broadcastRemoteUpdate(narrativeId: string, seq: number, update: Uint8Array): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('yjs:remote-update', { narrativeId, seq, update })
  }
}

async function pullForNarrative(
  sb: SupabaseClient,
  narrativeId: string
): Promise<void> {
  const { lastPulledRemoteId } = getSyncState(narrativeId)
  const { data, error } = await sb
    .from('narrative_updates')
    .select('id, update_blob')
    .eq('narrative_id', narrativeId)
    .gt('id', lastPulledRemoteId)
    .order('id', { ascending: true })

  if (error) {
    console.error('[sync] pull updates failed for', narrativeId, error.message)
    return
  }
  if (!data || data.length === 0) return

  for (const row of data as Array<{ id: number; update_blob: string }>) {
    const bytes = base64ToBytes(row.update_blob)
    const localSeq = applyRemoteUpdate(narrativeId, bytes)
    setSyncState(narrativeId, { lastPulledRemoteId: row.id })
    broadcastRemoteUpdate(narrativeId, localSeq, bytes)
  }
}

async function pullFromRemote(): Promise<void> {
  const sb = await ensureAuthenticated()
  if (!sb) return

  const {
    data: { user }
  } = await sb.auth.getUser()
  if (!user) return

  const { data: remoteNarratives, error } = await sb
    .from('narratives')
    .select('id, title, tags, created_at, updated_at')
    .eq('user_id', user.id)

  if (error) {
    console.error('[sync] list remote narratives failed', error.message)
    return
  }
  if (!remoteNarratives) return

  for (const rn of remoteNarratives as Array<{
    id: string
    title: string
    tags: string[] | null
    created_at: string
    updated_at: string
  }>) {
    if (!getNarrative(rn.id)) {
      try {
        createNarrative({
          id: rn.id,
          title: rn.title,
          tags: rn.tags ?? []
        })
      } catch (err) {
        console.error('[sync] create local narrative failed', err)
        continue
      }
    }
    await pullForNarrative(sb, rn.id)
  }
}

// ── Cycle ──

async function syncCycle(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await pullFromRemote()

    // After pulling, push any local updates not yet on remote.
    const local = listNarratives()
    for (const n of local) {
      try {
        await pushOne(n.id)
      } catch (err) {
        console.error('[sync] push during cycle failed for', n.id, err)
      }
    }
  } finally {
    syncing = false
  }
}

// ── Public API (preserved from old sync.ts so ipc.ts is unchanged) ──

export function schedulePush(narrativeId: string): void {
  const existing = pendingPushes.get(narrativeId)
  if (existing) clearTimeout(existing)
  const handle = setTimeout(() => {
    pendingPushes.delete(narrativeId)
    pushOne(narrativeId).catch((err) => {
      console.error('[sync] schedulePush dispatch failed', err)
    })
  }, PUSH_DEBOUNCE_MS)
  pendingPushes.set(narrativeId, handle)
}

export function schedulePushDelete(narrativeId: string): void {
  const handle = pendingPushes.get(narrativeId)
  if (handle) {
    clearTimeout(handle)
    pendingPushes.delete(narrativeId)
  }
  pushDelete(narrativeId).catch((err) => {
    console.error('[sync] schedulePushDelete failed', err)
  })
}

export function startSync(): void {
  syncCycle().catch((err) => console.error('[sync] initial cycle failed', err))
  syncTimer = setInterval(() => {
    syncCycle().catch((err) => console.error('[sync] interval cycle failed', err))
  }, SYNC_INTERVAL_MS)
}

export function stopSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
  for (const handle of pendingPushes.values()) clearTimeout(handle)
  pendingPushes.clear()
}

export function syncNow(): void {
  syncCycle().catch((err) => console.error('[sync] syncNow failed', err))
}
