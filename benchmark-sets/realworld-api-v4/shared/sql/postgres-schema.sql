BEGIN;

CREATE SCHEMA IF NOT EXISTS benchmark_private;
REVOKE ALL ON SCHEMA benchmark_private FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS benchmark_auth;
REVOKE ALL ON SCHEMA benchmark_auth FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS benchmark_extensions;
REVOKE ALL ON SCHEMA benchmark_extensions FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA benchmark_extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA benchmark_extensions;
DO $$
DECLARE extension_name text;
BEGIN
  FOR extension_name IN SELECT e.extname
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname IN ('pgcrypto', 'pg_trgm') AND n.nspname <> 'benchmark_extensions'
  LOOP
    EXECUTE pg_catalog.format('ALTER EXTENSION %I SET SCHEMA benchmark_extensions', extension_name);
  END LOOP;
END
$$;

CREATE TABLE public.users (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+$'),
  auth_subject text UNIQUE,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (length(display_name) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE public.organizations (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+$'),
  name text NOT NULL CHECK (length(name) > 0),
  owner_id text NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE public.memberships (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+$'),
  organization_id text NOT NULL REFERENCES public.organizations(id),
  user_id text NOT NULL REFERENCES public.users(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, user_id)
);
CREATE TABLE public.projects (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+$'),
  organization_id text NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL CHECK (length(name) > 0),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id)
);
CREATE TABLE public.tasks (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+$'),
  organization_id text NOT NULL,
  project_id text NOT NULL,
  creator_id text NOT NULL,
  assignee_id text,
  title text NOT NULL CHECK (length(title) > 0),
  description text NOT NULL,
  status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (project_id, organization_id) REFERENCES public.projects(id, organization_id),
  FOREIGN KEY (organization_id, creator_id) REFERENCES public.memberships(organization_id, user_id),
  FOREIGN KEY (organization_id, assignee_id) REFERENCES public.memberships(organization_id, user_id),
  UNIQUE (id, project_id, organization_id)
);
CREATE TABLE public.comments (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+$'),
  organization_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  author_id text NOT NULL,
  body text NOT NULL CHECK (length(body) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (task_id, project_id, organization_id) REFERENCES public.tasks(id, project_id, organization_id),
  FOREIGN KEY (organization_id, author_id) REFERENCES public.memberships(organization_id, user_id)
);
CREATE TABLE public.activities (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+$'),
  organization_id text NOT NULL REFERENCES public.organizations(id),
  project_id text REFERENCES public.projects(id),
  actor_id text NOT NULL REFERENCES public.users(id),
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (project_id, organization_id) REFERENCES public.projects(id, organization_id),
  FOREIGN KEY (organization_id, actor_id) REFERENCES public.memberships(organization_id, user_id)
);

CREATE INDEX memberships_user_idx ON public.memberships(user_id, organization_id);
CREATE INDEX projects_organization_idx ON public.projects(organization_id, created_at, id);
CREATE INDEX tasks_project_idx ON public.tasks(organization_id, project_id, created_at, id);
CREATE INDEX tasks_assignee_idx ON public.tasks(organization_id, assignee_id);
CREATE INDEX tasks_title_idx ON public.tasks USING gin(title benchmark_extensions.gin_trgm_ops);
CREATE INDEX comments_task_idx ON public.comments(organization_id, project_id, task_id, created_at, id);
CREATE INDEX activities_organization_idx ON public.activities(organization_id, created_at DESC, id DESC);

-- Identity is supplied by the request transaction.  These settings are native to
-- PostgREST JWTs, Hasura/Nhost sessions, and the benchmark's Neon session RPC.
CREATE FUNCTION benchmark_private.request_subject() RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(
    nullif(current_setting('app.user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''),
    nullif(nullif(current_setting('hasura.user', true), '')::jsonb ->> 'x-hasura-user-id', ''),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'x-hasura-user-id', '')
  )
$$;
CREATE FUNCTION benchmark_private.current_user_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id FROM public.users u
  WHERE u.id = benchmark_private.request_subject()
     OR u.auth_subject = benchmark_private.request_subject()
  LIMIT 1
$$;
CREATE FUNCTION benchmark_private.is_member(org_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships m
    WHERE m.organization_id = org_id AND m.user_id = benchmark_private.current_user_id())
$$;
CREATE FUNCTION benchmark_private.is_manager(org_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships m
    WHERE m.organization_id = org_id AND m.user_id = benchmark_private.current_user_id()
      AND m.role IN ('owner', 'admin'))
$$;
CREATE FUNCTION benchmark_private.task_organization(task_row public.tasks) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p.organization_id FROM public.projects p WHERE p.id = task_row.project_id
$$;
CREATE FUNCTION benchmark_private.comment_organization(comment_row public.comments) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p.organization_id FROM public.tasks t JOIN public.projects p ON p.id = t.project_id
  WHERE t.id = comment_row.task_id
$$;

CREATE FUNCTION benchmark_private.log_workflow_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  app_user text := benchmark_private.current_user_id();
  task_id text;
  project_id text;
  organization_id text;
BEGIN
  IF app_user IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'comments' THEN
    task_id := NEW.task_id;
    SELECT t.project_id, p.organization_id INTO project_id, organization_id
      FROM public.tasks t JOIN public.projects p ON p.id = t.project_id WHERE t.id = NEW.task_id;
  ELSE
    task_id := NEW.id;
    project_id := NEW.project_id;
    SELECT p.organization_id INTO organization_id FROM public.projects p WHERE p.id = NEW.project_id;
  END IF;
  INSERT INTO public.activities(id, organization_id, project_id, actor_id, action, subject_type, subject_id, created_at)
  VALUES (pg_catalog.substr(pg_catalog.replace(benchmark_extensions.gen_random_uuid()::text, '-', ''), 1, 15), organization_id, project_id, app_user,
    CASE WHEN TG_TABLE_NAME = 'comments' THEN CASE WHEN TG_OP = 'INSERT' THEN 'commented' ELSE 'comment_updated' END
         ELSE CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END END,
    'task', task_id, pg_catalog.clock_timestamp());
  RETURN NEW;
END
$$;
CREATE TRIGGER tasks_activity AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION benchmark_private.log_workflow_activity();
CREATE TRIGGER comments_activity AFTER INSERT OR UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION benchmark_private.log_workflow_activity();

CREATE TABLE benchmark_auth.passwords (
  user_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL CHECK (password_hash LIKE '$%')
);
CREATE TABLE benchmark_auth.sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sessions_user_idx ON benchmark_auth.sessions(user_id, expires_at);

CREATE FUNCTION benchmark_auth.sign_in(login_email text, login_password text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE app_user text; token text;
BEGIN
  SELECT u.id INTO app_user FROM public.users u JOIN benchmark_auth.passwords p ON p.user_id = u.id
    WHERE u.email = login_email AND p.password_hash = benchmark_extensions.crypt(login_password, p.password_hash);
  IF app_user IS NULL THEN RAISE EXCEPTION 'invalid credentials' USING ERRCODE = '28000'; END IF;
  token := pg_catalog.encode(benchmark_extensions.gen_random_bytes(32), 'hex');
  INSERT INTO benchmark_auth.sessions(token_hash, user_id, expires_at)
    VALUES (pg_catalog.encode(benchmark_extensions.digest(token, 'sha256'), 'hex'), app_user, pg_catalog.clock_timestamp() + interval '1 hour');
  PERFORM pg_catalog.set_config('app.user_id', app_user, true);
  RETURN token;
END
$$;
CREATE FUNCTION benchmark_auth.validate_session(session_token text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE app_user text;
BEGIN
  SELECT s.user_id INTO app_user FROM benchmark_auth.sessions s
    WHERE s.token_hash = pg_catalog.encode(benchmark_extensions.digest(session_token, 'sha256'), 'hex') AND s.expires_at > pg_catalog.clock_timestamp();
  IF app_user IS NULL THEN RAISE EXCEPTION 'invalid session' USING ERRCODE = '28000'; END IF;
  PERFORM pg_catalog.set_config('app.user_id', app_user, true);
  RETURN app_user;
END
$$;
CREATE FUNCTION benchmark_auth.sign_out(session_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  DELETE FROM benchmark_auth.sessions
    WHERE token_hash = pg_catalog.encode(benchmark_extensions.digest(session_token, 'sha256'), 'hex');
  PERFORM pg_catalog.set_config('app.user_id', '', true);
  RETURN FOUND;
END
$$;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_peer_read ON public.users FOR SELECT USING (
  id = benchmark_private.current_user_id() OR EXISTS (
    SELECT 1 FROM public.memberships mine JOIN public.memberships peer USING (organization_id)
    WHERE mine.user_id = benchmark_private.current_user_id() AND peer.user_id = users.id));
CREATE POLICY users_self_write ON public.users FOR UPDATE USING (id = benchmark_private.current_user_id())
  WITH CHECK (id = benchmark_private.current_user_id());
CREATE POLICY organizations_member_read ON public.organizations FOR SELECT USING (benchmark_private.is_member(id));
CREATE POLICY memberships_member_read ON public.memberships FOR SELECT USING (benchmark_private.is_member(organization_id));
CREATE POLICY memberships_manager_write ON public.memberships FOR UPDATE USING (benchmark_private.is_manager(organization_id))
  WITH CHECK (benchmark_private.is_manager(organization_id));
CREATE POLICY projects_member_read ON public.projects FOR SELECT USING (benchmark_private.is_member(organization_id));
CREATE POLICY projects_manager_write ON public.projects FOR ALL USING (benchmark_private.is_manager(organization_id))
  WITH CHECK (benchmark_private.is_manager(organization_id));
CREATE POLICY tasks_member_read ON public.tasks FOR SELECT USING (benchmark_private.is_member(benchmark_private.task_organization(tasks)));
CREATE POLICY tasks_member_insert ON public.tasks FOR INSERT WITH CHECK (
  benchmark_private.is_member(benchmark_private.task_organization(tasks)) AND creator_id = benchmark_private.current_user_id());
CREATE POLICY tasks_member_update ON public.tasks FOR UPDATE USING (benchmark_private.is_member(benchmark_private.task_organization(tasks)))
  WITH CHECK (benchmark_private.is_member(benchmark_private.task_organization(tasks)));
CREATE POLICY tasks_member_delete ON public.tasks FOR DELETE USING (benchmark_private.is_member(benchmark_private.task_organization(tasks)));
CREATE POLICY comments_member_read ON public.comments FOR SELECT USING (benchmark_private.is_member(benchmark_private.comment_organization(comments)));
CREATE POLICY comments_member_insert ON public.comments FOR INSERT WITH CHECK (
  benchmark_private.is_member(benchmark_private.comment_organization(comments)) AND author_id = benchmark_private.current_user_id());
CREATE POLICY comments_member_update ON public.comments FOR UPDATE USING (
  author_id = benchmark_private.current_user_id() OR benchmark_private.is_manager(benchmark_private.comment_organization(comments)))
  WITH CHECK (benchmark_private.is_member(benchmark_private.comment_organization(comments)));
CREATE POLICY comments_member_delete ON public.comments FOR DELETE USING (
  author_id = benchmark_private.current_user_id() OR benchmark_private.is_manager(benchmark_private.comment_organization(comments)));
CREATE POLICY activities_member_read ON public.activities FOR SELECT USING (benchmark_private.is_member(organization_id));
CREATE POLICY activities_actor_insert ON public.activities FOR INSERT WITH CHECK (
  benchmark_private.is_member(organization_id) AND actor_id = benchmark_private.current_user_id());

COMMIT;
