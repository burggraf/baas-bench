# neon/direct-postgres

Connects to `127.0.0.1:55433`, database `postgres`, as `cloud_admin`, through the Neon compute PostgreSQL endpoint. SSL is not added by the benchmark. Every virtual user owns a lazy one-connection `pg` pool; connection failures are counted by timed operations.
