-- Phase 2: Split narratives into narratives (metadata) + drafts (content)
-- This migration:
--   1. Creates the drafts table
--   2. Migrates existing content from narratives into drafts
--   3. Adds active_draft_id and tags to narratives
--   4. Sets active_draft_id to the newly created draft for each narrative
--   5. Drops the content column from narratives
--   6. Sets up RLS, grants, and triggers on drafts

-- ── 1. Create drafts table ──

create table "public"."drafts" (
  "id" uuid not null default gen_random_uuid(),
  "narrative_id" uuid not null,
  "parent_draft_id" uuid,
  "label" text,
  "content" jsonb default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

alter table "public"."drafts" enable row level security;

CREATE UNIQUE INDEX drafts_pkey ON public.drafts USING btree (id);
CREATE INDEX drafts_narrative_id_idx ON public.drafts USING btree (narrative_id);

alter table "public"."drafts" add constraint "drafts_pkey" PRIMARY KEY using index "drafts_pkey";

alter table "public"."drafts" add constraint "drafts_narrative_id_fkey"
  FOREIGN KEY (narrative_id) REFERENCES public.narratives(id) ON DELETE CASCADE;

alter table "public"."drafts" add constraint "drafts_parent_draft_id_fkey"
  FOREIGN KEY (parent_draft_id) REFERENCES public.drafts(id) ON DELETE SET NULL;

-- ── 2. Migrate existing content into drafts ──

insert into "public"."drafts" (narrative_id, content, created_at, updated_at)
select id, coalesce(content, '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb), created_at, updated_at
from "public"."narratives";

-- ── 3. Add new columns to narratives ──

alter table "public"."narratives" add column "active_draft_id" uuid;
alter table "public"."narratives" add column "tags" text[] not null default '{}';

-- ── 4. Set active_draft_id to the migrated draft ──

update "public"."narratives" n
set active_draft_id = d.id
from "public"."drafts" d
where d.narrative_id = n.id;

-- ── 5. Add FK constraint for active_draft_id ──

alter table "public"."narratives" add constraint "narratives_active_draft_id_fkey"
  FOREIGN KEY (active_draft_id) REFERENCES public.drafts(id) ON DELETE SET NULL;

-- ── 6. Drop content column from narratives ──

alter table "public"."narratives" drop column "content";

-- ── 7. RLS policies for drafts (mirror narrative ownership via join) ──

create policy "Users can read own drafts"
  on "public"."drafts"
  as permissive
  for select
  to public
  using (
    exists (
      select 1 from "public"."narratives"
      where narratives.id = drafts.narrative_id
        and narratives.user_id = auth.uid()
    )
  );

create policy "Users can insert own drafts"
  on "public"."drafts"
  as permissive
  for insert
  to public
  with check (
    exists (
      select 1 from "public"."narratives"
      where narratives.id = drafts.narrative_id
        and narratives.user_id = auth.uid()
    )
  );

create policy "Users can update own drafts"
  on "public"."drafts"
  as permissive
  for update
  to public
  using (
    exists (
      select 1 from "public"."narratives"
      where narratives.id = drafts.narrative_id
        and narratives.user_id = auth.uid()
    )
  );

create policy "Users can delete own drafts"
  on "public"."drafts"
  as permissive
  for delete
  to public
  using (
    exists (
      select 1 from "public"."narratives"
      where narratives.id = drafts.narrative_id
        and narratives.user_id = auth.uid()
    )
  );

-- ── 8. Grants for drafts (same pattern as narratives) ──

grant select, insert, update, delete, references, trigger, truncate on table "public"."drafts" to "anon";
grant select, insert, update, delete, references, trigger, truncate on table "public"."drafts" to "authenticated";
grant select, insert, update, delete, references, trigger, truncate on table "public"."drafts" to "service_role";

-- ── 9. Auto-update trigger for drafts.updated_at ──

CREATE TRIGGER drafts_updated_at BEFORE UPDATE ON public.drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
