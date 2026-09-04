# nhost/direct-postgres

Connects to `127.0.0.1:5432`, database `postgres`, as `postgres`, through the port already published by the pinned Nhost deployment. SSL is not added by the benchmark. Every virtual user owns a lazy one-connection `pg` pool; connection failures are counted by timed operations.
