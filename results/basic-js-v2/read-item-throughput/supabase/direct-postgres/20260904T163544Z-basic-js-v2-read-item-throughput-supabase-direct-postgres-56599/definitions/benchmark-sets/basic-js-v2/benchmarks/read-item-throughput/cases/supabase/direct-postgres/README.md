# supabase/direct-postgres

Connects to `127.0.0.1:15432`, database `postgres`, as `postgres`, directly to the database container port published by `bin/baas setup supabase`. SSL is not added by the benchmark. Every virtual user owns a lazy one-connection `pg` pool; connection failures are counted by timed operations.
