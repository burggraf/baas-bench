-- Run ONLY in a fresh disposable PostgreSQL database as its superuser:
-- psql -X -v ON_ERROR_STOP=1 -d disposable_db -f test/supabase_v5_rls_test.sql
-- No Supabase stack is needed. Exercise V5 PostgreSQL policies before/after overlay.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
\ir ../benchmark-sets/realworld-api-v5/shared/sql/postgres-schema.sql

INSERT INTO public.users(id, auth_subject, email, display_name, created_at, updated_at) VALUES
  ('owner', 'authowner', 'owner@example.test', 'Owner', now(), now()),
  ('admin', 'authadmin', 'admin@example.test', 'Admin', now(), now()),
  ('member', 'authmember', 'member@example.test', 'Member', now(), now()),
  ('outsider', 'authoutsider', 'outsider@example.test', 'Outsider', now(), now());
INSERT INTO public.organizations VALUES ('orga', 'A', 'owner', now()), ('orgb', 'B', 'outsider', now());
INSERT INTO public.memberships VALUES
  ('mowner', 'orga', 'owner', 'owner', now()), ('madmin', 'orga', 'admin', 'admin', now()),
  ('mmember', 'orga', 'member', 'member', now()), ('moutsider', 'orgb', 'outsider', 'owner', now());
INSERT INTO public.projects VALUES
  ('projecta', 'orga', 'A', 'active', now(), now()), ('projectb', 'orgb', 'B', 'active', now(), now());
INSERT INTO public.tasks VALUES
  ('taska', 'orga', 'projecta', 'owner', 'member', 'Task A', 'A', 'todo', 'low', NULL, now(), now()),
  ('taskb', 'orgb', 'projectb', 'outsider', NULL, 'Task B', 'B', 'todo', 'low', NULL, now(), now());
INSERT INTO public.comments VALUES
  ('commenta', 'orga', 'projecta', 'taska', 'owner', 'A', now(), now()),
  ('commentb', 'orgb', 'projectb', 'taskb', 'outsider', 'B', now(), now());
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE FUNCTION public.assert_supabase_rls() RETURNS void LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'must exercise RLS as authenticated'; END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"authmember"}', true);
  IF (SELECT count(*) FROM public.users) <> 3
    OR (SELECT count(*) FROM public.memberships) <> 3
    OR (SELECT count(*) FROM public.organizations) <> 1
    OR (SELECT count(*) FROM public.projects) <> 1
    OR (SELECT count(*) FROM public.tasks) <> 1
    OR (SELECT count(*) FROM public.comments) <> 1
    THEN RAISE EXCEPTION 'member/peer/tenant read contract changed'; END IF;
  UPDATE public.users SET display_name = 'No' WHERE id = 'owner';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'member edited another user'; END IF;
  UPDATE public.users SET display_name = 'Yes' WHERE id = 'member';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'self-update denied'; END IF;
  UPDATE public.memberships SET role = 'admin' WHERE id = 'mmember';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'member escalated role'; END IF;
  UPDATE public.projects SET name = 'No' WHERE id = 'projecta';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'member edited manager-only project'; END IF;
  UPDATE public.comments SET body = 'No' WHERE id = 'commenta';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'member edited another author comment'; END IF;

  BEGIN
    INSERT INTO public.tasks VALUES ('spoof', 'orga', 'projecta', 'owner', NULL, 'X', 'X', 'todo', 'low', NULL, now(), now());
    RAISE EXCEPTION 'spoofed creator accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.comments VALUES ('spoof', 'orga', 'projecta', 'taska', 'owner', 'X', now(), now());
    RAISE EXCEPTION 'spoofed author accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.tasks VALUES ('forged', 'orga', 'projectb', 'member', NULL, 'X', 'X', 'todo', 'low', NULL, now(), now());
    RAISE EXCEPTION 'forged project/tenant accepted';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.comments VALUES ('forged', 'orga', 'projecta', 'taskb', 'member', 'X', now(), now());
    RAISE EXCEPTION 'forged task/tenant accepted';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;

  INSERT INTO public.tasks VALUES ('newtask', 'orga', 'projecta', 'member', NULL, 'X', 'X', 'todo', 'low', NULL, now(), now());
  UPDATE public.tasks SET title = 'Updated' WHERE id = 'newtask';
  INSERT INTO public.comments VALUES ('newcomment', 'orga', 'projecta', 'newtask', 'member', 'X', now(), now());
  UPDATE public.comments SET body = 'Updated' WHERE id = 'newcomment';
  IF (SELECT count(*) FROM public.activities WHERE actor_id = 'member') <> 4
    THEN RAISE EXCEPTION 'write activity semantics changed'; END IF;
  DELETE FROM public.comments WHERE id = 'newcomment';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'author delete denied'; END IF;

  PERFORM set_config('request.jwt.claims', '{"sub":"authoutsider"}', true);
  IF (SELECT count(*) FROM public.users) <> 1 OR EXISTS (SELECT 1 FROM public.tasks WHERE id = 'taska')
    OR EXISTS (SELECT 1 FROM public.comments WHERE id = 'commenta')
    THEN RAISE EXCEPTION 'outsider saw another tenant'; END IF;
  UPDATE public.tasks SET title = 'No' WHERE id = 'taska';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'outsider edited task'; END IF;
  BEGIN
    INSERT INTO public.tasks VALUES ('outsiderwrite', 'orga', 'projecta', 'outsider', NULL, 'X', 'X', 'todo', 'low', NULL, now(), now());
    RAISE EXCEPTION 'outsider insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Same connection/transaction, changed identity and role: no cached JWT tenants.
  PERFORM set_config('request.jwt.claims', '{"sub":"authowner"}', true);
  UPDATE public.memberships SET role = 'admin' WHERE id = 'mmember';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'owner role update denied'; END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"authmember"}', true);
  UPDATE public.comments SET body = 'Manager edit' WHERE id = 'commenta';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'promoted manager permission stale'; END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"authadmin"}', true);
  UPDATE public.memberships SET role = 'member' WHERE id = 'mmember';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'admin role restore denied'; END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"authmember"}', true);
  UPDATE public.comments SET body = 'No' WHERE id = 'commenta';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'demoted manager permission stale'; END IF;
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF EXISTS (SELECT 1 FROM public.users) OR EXISTS (SELECT 1 FROM public.tasks)
    THEN RAISE EXCEPTION 'missing subject saw data'; END IF;
END
$$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.assert_supabase_rls();
ROLLBACK;
\ir ../benchmark-sets/realworld-api-v5/shared/sql/supabase-rls.sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.assert_supabase_rls();
ROLLBACK;
\echo Supabase baseline and optimized RLS contracts passed
