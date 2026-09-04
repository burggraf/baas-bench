# supabase/pooler-postgres

Connects to `127.0.0.1:6543`, database `postgres`, using the tenant-qualified `postgres.<POOLER_TENANT_ID>` role through the Supavisor transaction pooler included in the pinned deployment. SSL is not added by the benchmark. Every virtual user owns a lazy one-connection `pg` pool; connection failures are counted by timed operations.
