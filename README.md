# UL Temenos

A long-form writing app with a live AI feedback partner. Local-first, every keystroke durable in milliseconds, offline-friendly, and conflict-free across devices.

Mac-only Electron app. Built on TipTap + Yjs (CRDT) + SQLite, syncing to Supabase.

## Quick start

```bash
git clone https://github.com/deshpanderitwik/ul-temenos-v2.git
cd ul-temenos-v2
cp .env.example .env   # then fill in Supabase URL + anon key + user creds
npm install
npm run dev
```

The first launch creates `~/.temenos/temenos.db` and (if you have a legacy JSON store from an earlier version) migrates it into the new system. Your old folder is renamed to `~/.temenos/narratives.json-backup-<timestamp>` rather than deleted.

## What's in the box

- **Distraction-free editor.** TipTap on top of ProseMirror with a custom caret-anchor scroll behavior that keeps the line you're writing near the viewport's middle.
- **Real autosave.** Every keystroke produces a Yjs binary update, persisted to SQLite via IPC within ~10 ms. No debounce window, no in-flight state machine, no possibility of corrupted mid-write.
- **Multi-device sync.** Yjs updates push to and pull from Supabase. Two devices editing the same narrative offline merge cleanly when reconnected — no last-write-wins, no lost edits.
- **MCP server.** Claude (or any MCP-compatible client) can `list / get / create / append / update` your narratives. Edits propagate live to the running editor.

## Architecture

```
Renderer (React + TipTap + @tiptap/extension-collaboration)
        │  Y.Doc updates over IPC
        ▼
Main process (Electron)
   ├─ ~/.temenos/temenos.db   ← SQLite (WAL mode)
   │     ├─ narratives          metadata + timestamps
   │     ├─ narrative_updates   append-only Yjs binary updates
   │     └─ sync_state          per-narrative push/pull cursors
   │
   ├─ Supabase sync             pushes/pulls Yjs updates over a 60s cycle
   │                            (and on window focus)
   │
   └─ MCP IPC                   shared SQLite — MCP edits broadcast
                                to the running editor live
```

Two tables on Supabase mirror the local store:

- `narratives(id, user_id, title, tags, created_at, updated_at, ...)`
- `narrative_updates(id, narrative_id, update_blob, created_at)` — append-only

Row-level security joins through `narratives.user_id`. The Yjs CRDT means concurrent edits on multiple devices merge mathematically; there is no conflict resolution layer to write or maintain.

## Project layout

```
src/
├── main/                Electron main process
│   ├── index.ts         lifecycle, window, autoupdate
│   ├── sync.ts          Supabase push/pull
│   ├── supabaseMain.ts  auth + token refresh
│   └── yjs/
│       ├── db.ts          SQLite + schema
│       ├── persistence.ts CRUD + Yjs append/load + sync_state + compaction
│       ├── ipc.ts         IPC handlers under the yjs:* namespace
│       └── migrate.ts     legacy JSON → Yjs migration (one-shot)
│
├── preload/             contextBridge — exposes window.api.yjs.*
│
├── renderer/src/        React app
│   ├── components/      WritingWorkspace · NarrativeEditor · TimerPopover · …
│   ├── lib/             yjsClient · narrativeStore · caretAnchor · deriveTitle
│   └── styles/          Tailwind globals
│
└── mcp/                 standalone MCP server (`npm run mcp:dev`)
    ├── server.ts        list / get / create / append / update tools
    └── yjs-mcp-bridge.ts Y.Doc ↔ TipTap JSON helpers
```

## Scripts

```bash
npm run dev            # launch Electron + Vite HMR
npm run build          # type-check + bundle (no packaging)
npm run dist           # build + electron-builder → release/ (.app and .zip)
npm test               # vitest — persistence, migration, MCP bridge, CRDT merge
npm run mcp:dev        # standalone MCP server (stdio transport)
npm run rebuild:native # rebuild better-sqlite3 for Electron's Node ABI
npm run rebuild:node   # rebuild better-sqlite3 for system Node ABI (for tests/MCP)
```

A note on native modules: `better-sqlite3` is compiled against either Electron's Node ABI or the system Node ABI, and they don't coexist. The default is Electron (set by `postinstall`). `npm test` and `npm run mcp:dev` flip to system Node and back automatically.

## Configuration

Environment variables live in `.env` (gitignored):

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_SUPABASE_USER_EMAIL=<email>
VITE_SUPABASE_USER_PASSWORD=<password>
```

The desktop app reads these in the main process; nothing prefixed with `VITE_` is referenced from the renderer for credentials.

## Storage

- **Local data:** `~/.temenos/temenos.db` (a single SQLite file, plus `-wal` and `-shm` siblings while running)
- **Supabase migrations:** `supabase/migrations/` — apply with `supabase db push`
- **Legacy backup (if migrated):** `~/.temenos/narratives.json-backup-<timestamp>/`

## Tests

```bash
npm test
```

Covers: persistence round-trips, sync_state invariants, applyRemoteUpdate (no echo-back), narrative metadata CRUD, log compaction, migration idempotency including rich-mark round-trips, MCP bridge replacement semantics, and a CRDT merge of concurrent editor + MCP edits.

## License

Personal project; no public license. Reach out before redistributing.
