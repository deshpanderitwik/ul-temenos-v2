drop extension if exists "pg_net";


  create table "public"."narratives" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "title" text not null default 'Untitled'::text,
    "content" jsonb default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."narratives" enable row level security;

CREATE UNIQUE INDEX narratives_pkey ON public.narratives USING btree (id);

alter table "public"."narratives" add constraint "narratives_pkey" PRIMARY KEY using index "narratives_pkey";

alter table "public"."narratives" add constraint "narratives_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."narratives" validate constraint "narratives_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

grant delete on table "public"."narratives" to "anon";

grant insert on table "public"."narratives" to "anon";

grant references on table "public"."narratives" to "anon";

grant select on table "public"."narratives" to "anon";

grant trigger on table "public"."narratives" to "anon";

grant truncate on table "public"."narratives" to "anon";

grant update on table "public"."narratives" to "anon";

grant delete on table "public"."narratives" to "authenticated";

grant insert on table "public"."narratives" to "authenticated";

grant references on table "public"."narratives" to "authenticated";

grant select on table "public"."narratives" to "authenticated";

grant trigger on table "public"."narratives" to "authenticated";

grant truncate on table "public"."narratives" to "authenticated";

grant update on table "public"."narratives" to "authenticated";

grant delete on table "public"."narratives" to "service_role";

grant insert on table "public"."narratives" to "service_role";

grant references on table "public"."narratives" to "service_role";

grant select on table "public"."narratives" to "service_role";

grant trigger on table "public"."narratives" to "service_role";

grant truncate on table "public"."narratives" to "service_role";

grant update on table "public"."narratives" to "service_role";


  create policy "Users can delete own narratives"
  on "public"."narratives"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "Users can insert own narratives"
  on "public"."narratives"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "Users can read own narratives"
  on "public"."narratives"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "Users can update own narratives"
  on "public"."narratives"
  as permissive
  for update
  to public
using ((auth.uid() = user_id));


CREATE TRIGGER narratives_updated_at BEFORE UPDATE ON public.narratives FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


