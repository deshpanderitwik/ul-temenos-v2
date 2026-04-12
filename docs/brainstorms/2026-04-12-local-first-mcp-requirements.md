---
date: 2026-04-12
topic: local-first-mcp
---

# Local-First Architecture and MCP Integration

## Problem Frame

Temenos is a writing app that currently treats Supabase as the sole data store. Every read and write goes over the network. This causes three problems:

1. **Narrative loads have visible latency.** Switching between narratives requires a network round-trip.
2. **The app doesn't work offline.** No connection means no writing.
3. **MCP integration is unnecessarily complex.** The MCP server needs Supabase credentials, auth, and a network connection -- just to pass text from Claude Desktop to the Electron app running on the same machine.

All three stem from the same root: the app has no local data layer. The fix is to make the local filesystem the primary data store and treat Supabase as a sync layer.

## Approach: Phased Migration to Local-First

### Phase 1: Local-First Data Layer (immediate)

Move all narrative storage to local JSON files on disk. The app reads and writes locally -- instant opens, works offline. The Electron main process handles file I/O and exposes it to the renderer via IPC.

### Phase 2: Supabase Schema Migration (next)

Update the Supabase schema to mirror the local data model 1:1. Today Supabase has a flat `narratives` table with content inlined. After this phase, Supabase has separate `narratives` (metadata) and `drafts` (content) tables that match the local file structure exactly. This ensures the cloud is a full-fidelity mirror -- no lossy flattening during sync, and the schema is ready for a future web client, multi-device use, or collaboration.

### Phase 3: Bidirectional Supabase Sync (after schema migration)

Add a background sync engine that pushes local changes to Supabase and pulls remote changes down. Because the schema matches 1:1, sync is straightforward record-level replication: each local `narrative.json` maps to a row in `narratives`, each draft file maps to a row in `drafts`. Last-write-wins conflict resolution based on `updatedAt`. The sync is asynchronous and non-blocking.

### Phase 4: MCP Integration (after sync)

The MCP server writes directly to the local narrative store -- same format the app reads. No credentials, no network, no special inbox. MCP is just another writer to the local store. The app's existing file-watching picks it up.

---

## Local Data Format

### Directory Structure

```
~/.temenos/
  narratives/
    <uuid>/
      narrative.json
      drafts/
        <uuid>.json
      history/               # future: version snapshots
      annotations/           # future: AI feedback
      assets/                # future: images, media
  index.json
```

### `narrative.json` -- Lightweight Metadata (no content)

```json
{
  "id": "<uuid>",
  "title": "Morning Pages",
  "activeDraftId": "<draft-uuid>",
  "tags": [],
  "createdAt": "2026-04-12T10:00:00Z",
  "updatedAt": "2026-04-12T14:30:00Z"
}
```

### `drafts/<uuid>.json` -- The Actual Writing

```json
{
  "id": "<draft-uuid>",
  "narrativeId": "<uuid>",
  "parentDraftId": null,
  "label": null,
  "content": { "type": "doc", "content": [{ "type": "paragraph" }] },
  "createdAt": "2026-04-12T10:00:00Z",
  "updatedAt": "2026-04-12T14:30:00Z"
}
```

Content is TipTap/ProseMirror JSON, matching the existing editor format.

Drafts support both linear history and branching via `parentDraftId`. Linear: a chain of drafts. Branching: multiple drafts share the same parent.

### `index.json` -- Fast List Rendering

```json
{
  "narratives": [
    { "id": "<uuid>", "title": "Morning Pages", "updatedAt": "2026-04-12T14:30:00Z" }
  ]
}
```

Avoids reading every `narrative.json` to render the narratives list.

### Design Properties

- **Metadata and content are separate.** Listing narratives never touches content.
- **Drafts are peers, not nested.** `activeDraftId` in `narrative.json` selects which draft the editor shows.
- **Future features are additive.** New subdirectories (`history/`, `annotations/`, `assets/`) add capability without restructuring existing data.
- **MCP writes are trivial.** Create a directory, write `narrative.json` + one draft file, update `index.json`.

---

## Phase 1 Requirements (Local-First Data Layer)

**Data Access Layer**

- R1. All narrative reads and writes go through local JSON files on disk, not Supabase.
- R2. The data directory is `~/.temenos/` (or a platform-appropriate app data path).
- R3. The directory structure follows the format described above.
- R4. An `index.json` file at the root provides a flat list of all narratives for fast list rendering.

**Electron Main Process (file I/O)**

- R5. The Electron main process owns all file I/O (read, write, watch, delete).
- R6. The main process exposes file operations to the renderer via IPC (contextBridge + ipcMain/ipcRenderer).
- R7. The IPC bridge is set up (preload script with contextBridge), since it doesn't currently exist.

**Renderer Integration**

- R8. The narratives list reads from `index.json` via IPC instead of Supabase.
- R9. Opening a narrative reads `narrative.json` + the active draft file via IPC instead of Supabase.
- R10. Autosave writes to the local draft file via IPC instead of Supabase.
- R11. Creating a new narrative creates the directory, `narrative.json`, an empty draft, and updates `index.json`.
- R12. Deleting a narrative removes the directory and updates `index.json`.
- R13. The title derivation logic (`deriveNarrativeTitleFromContent`) continues to work as-is -- it runs on content from the local draft instead of Supabase.

**File Watching**

- R14. The main process watches the narratives directory for external changes (for future MCP and sync use).
- R15. When an external change is detected (new directory, modified file), the main process notifies the renderer via IPC.

**Migration**

- R16. On first launch with the new local store, if the store is empty but Supabase has data, offer to import existing narratives from Supabase to local files.

## Success Criteria

- Opening a narrative is instant (< 50ms, no network).
- The app works fully offline -- create, edit, switch, delete narratives with no connection.
- The narratives list loads from `index.json` without reading content files.
- Autosave writes to disk with the same debounce/max-interval behavior as today.
- Existing narratives in Supabase can be imported on first use.

## Scope Boundaries

- Phase 1 does NOT include Supabase sync or schema changes. Supabase is not read from or written to after migration.
- Phase 1 does NOT include MCP. That comes in Phase 4.
- Phase 1 does NOT implement multiple drafts UI. The data format supports it, but the editor shows one draft per narrative (the `activeDraftId`).
- Phase 1 does NOT implement version history, annotations, or assets. The directories can be created in the structure but are unused.

## Key Decisions

- **Local store format: directory-per-narrative with JSON files.** Separates metadata from content. Supports future drafts, history, annotations, and assets without restructuring.
- **Draft model: both linear and branching.** `parentDraftId` supports version chains and parallel explorations. Phase 1 only uses a single draft per narrative.
- **Conflict resolution: last-write-wins.** Based on `updatedAt` timestamps. Acceptable for a single primary user.
- **File I/O in main process.** The renderer communicates via IPC. This is the Electron best practice for filesystem access.
- **Phase ordering: local-first -> schema migration -> sync -> MCP.** Each phase builds on the previous one without throwaway work. The schema migration before sync ensures the cloud is a full-fidelity mirror from the start.

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] What is the best platform-appropriate path? `~/.temenos/`, `app.getPath('userData')`, or configurable?
- [Affects R7][Technical] What shape should the IPC API take? Minimal set of operations vs. a generic file access layer?
- [Affects R14][Technical] Should file watching use `fs.watch`, `chokidar`, or Electron's built-in capabilities?
- [Affects R16][Technical] Should migration be automatic or prompted? What if the user has narratives in both places?

## Next Steps

-> `/ce:plan` for Phase 1 implementation planning
