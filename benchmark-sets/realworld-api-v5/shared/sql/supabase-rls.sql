BEGIN;

-- Supabase-only overlay: build authorized tenant sets in uncorrelated subqueries
-- rather than resolve identity and membership for every candidate row. No JWT
-- role/tenant cache: membership changes are visible on the next statement.
CREATE FUNCTION benchmark_private.member_organizations() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.organization_id FROM public.memberships m
  WHERE m.user_id = (SELECT benchmark_private.current_user_id())
$$;
CREATE FUNCTION benchmark_private.managed_organizations() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.organization_id FROM public.memberships m
  WHERE m.user_id = (SELECT benchmark_private.current_user_id())
    AND m.role IN ('owner', 'admin')
$$;
REVOKE ALL ON FUNCTION benchmark_private.member_organizations(), benchmark_private.managed_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION benchmark_private.member_organizations(), benchmark_private.managed_organizations() TO authenticated;

ALTER POLICY users_peer_read ON public.users USING (
  id = (SELECT benchmark_private.current_user_id()) OR id IN (
    SELECT peer.user_id FROM public.memberships peer
    WHERE peer.organization_id IN (SELECT benchmark_private.member_organizations())));
ALTER POLICY users_self_write ON public.users
  USING (id = (SELECT benchmark_private.current_user_id()))
  WITH CHECK (id = (SELECT benchmark_private.current_user_id()));
ALTER POLICY organizations_member_read ON public.organizations
  USING (id IN (SELECT benchmark_private.member_organizations()));
ALTER POLICY memberships_member_read ON public.memberships
  USING (organization_id IN (SELECT benchmark_private.member_organizations()));
ALTER POLICY memberships_manager_write ON public.memberships
  USING (organization_id IN (SELECT benchmark_private.managed_organizations()))
  WITH CHECK (organization_id IN (SELECT benchmark_private.managed_organizations()));
ALTER POLICY projects_member_read ON public.projects
  USING (organization_id IN (SELECT benchmark_private.member_organizations()));
ALTER POLICY projects_manager_write ON public.projects
  USING (organization_id IN (SELECT benchmark_private.managed_organizations()))
  WITH CHECK (organization_id IN (SELECT benchmark_private.managed_organizations()));

-- Composite foreign keys already bind tasks to their project's organization,
-- and comments to their task/project/organization. Keep those constraints: the
-- stored organization_id is safe to authorize without traversing parents again.
ALTER POLICY tasks_member_read ON public.tasks
  USING (organization_id IN (SELECT benchmark_private.member_organizations()));
ALTER POLICY tasks_member_insert ON public.tasks WITH CHECK (
  organization_id IN (SELECT benchmark_private.member_organizations())
  AND creator_id = (SELECT benchmark_private.current_user_id()));
ALTER POLICY tasks_member_update ON public.tasks
  USING (organization_id IN (SELECT benchmark_private.member_organizations()))
  WITH CHECK (organization_id IN (SELECT benchmark_private.member_organizations()));
ALTER POLICY tasks_member_delete ON public.tasks
  USING (organization_id IN (SELECT benchmark_private.member_organizations()));
ALTER POLICY comments_member_read ON public.comments
  USING (organization_id IN (SELECT benchmark_private.member_organizations()));
ALTER POLICY comments_member_insert ON public.comments WITH CHECK (
  organization_id IN (SELECT benchmark_private.member_organizations())
  AND author_id = (SELECT benchmark_private.current_user_id()));
ALTER POLICY comments_member_update ON public.comments USING (
  author_id = (SELECT benchmark_private.current_user_id())
  OR organization_id IN (SELECT benchmark_private.managed_organizations()))
  WITH CHECK (organization_id IN (SELECT benchmark_private.member_organizations()));
ALTER POLICY comments_member_delete ON public.comments USING (
  author_id = (SELECT benchmark_private.current_user_id())
  OR organization_id IN (SELECT benchmark_private.managed_organizations()));
ALTER POLICY activities_member_read ON public.activities
  USING (organization_id IN (SELECT benchmark_private.member_organizations()));
ALTER POLICY activities_actor_insert ON public.activities WITH CHECK (
  organization_id IN (SELECT benchmark_private.member_organizations())
  AND actor_id = (SELECT benchmark_private.current_user_id()));

-- Native updates cannot rebind authors/creators/tenants or the Auth mapping.
-- The database owner still owns seeding/reset; authenticated API clients get
-- only the supported application mutation columns.
REVOKE UPDATE ON public.users, public.memberships, public.projects, public.tasks, public.comments FROM PUBLIC, anon, authenticated;
GRANT UPDATE (display_name, updated_at) ON public.users TO authenticated;
GRANT UPDATE (role) ON public.memberships TO authenticated;
GRANT UPDATE (name, status, updated_at) ON public.projects TO authenticated;
GRANT UPDATE (title, description, status, priority, due_date, updated_at) ON public.tasks TO authenticated;
GRANT UPDATE (body, updated_at) ON public.comments TO authenticated;
-- Trigger insertion is SECURITY DEFINER; application clients cannot forge,
-- alter or delete the resulting immutable activity records.
REVOKE INSERT, UPDATE, DELETE ON public.activities FROM PUBLIC, anon, authenticated;

COMMIT;
