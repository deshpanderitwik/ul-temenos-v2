-- Phase 3: Yjs-aware narrative_updates table
--
-- Append-only log of binary Yjs updates per narrative. Each row is a single
-- Yjs update blob produced by the editor; concatenating them via Y.applyUpdate
-- reconstructs the document. Conflict resolution is built into Yjs — multiple
-- devices can insert concurrently and the merged state is mathematically
-- well-defined.
--
-- The blob is stored as base64 text rather than bytea to sidestep supabase-js
-- bytea round-trip quirks. The size overhead is ~33% which is negligible at
-- our scale (typical update is a few hundred bytes).
--
-- The legacy narratives and drafts tables remain untouched as a remote backup
-- through the Yjs cutover; nothing in this migration drops or modifies them.

create table "public"."narrative_updates" (
  "id" bigint generated always as identity primary key,
  "narrative_id" uuid not null,
  "update_blob" text not null,
  "created_at" timestamp with time zone not null default now()
);

create index narrative_updates_narrative_id_idx
  on "public"."narrative_updates" (narrative_id, id);

alter table "public"."narrative_updates"
  add constraint "narrative_updates_narrative_id_fkey"
  foreign key (narrative_id) references "public"."narratives"(id) on delete cascade;

alter table "public"."narrative_updates" enable row level security;

-- RLS via join through narratives.user_id — same pattern as drafts.

create policy "Users can read own narrative_updates"
  on "public"."narrative_updates"
  as permissive
  for select
  to public
  using (
    exists (
      select 1 from "public"."narratives"
      where narratives.id = narrative_updates.narrative_id
        and narratives.user_id = auth.uid()
    )
  );

create policy "Users can insert own narrative_updates"
  on "public"."narrative_updates"
  as permissive
  for insert
  to public
  with check (
    exists (
      select 1 from "public"."narratives"
      where narratives.id = narrative_updates.narrative_id
        and narratives.user_id = auth.uid()
    )
  );

-- Append-only by design: no update or delete policies for non-service roles.

grant select, insert, references, trigger on table "public"."narrative_updates" to "anon";
grant select, insert, references, trigger on table "public"."narrative_updates" to "authenticated";
grant select, insert, update, delete, references, trigger, truncate on table "public"."narrative_updates" to "service_role";
