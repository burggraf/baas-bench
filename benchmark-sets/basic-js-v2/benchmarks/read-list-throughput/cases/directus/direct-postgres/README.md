# directus/direct-postgres

Connects to `127.0.0.1:5432`, database `directus`, as `directus`, through the existing database service port published by the repository Compose definition. SSL is not added by the benchmark. Every virtual user owns a lazy one-connection `pg` pool; connection failures are counted by timed operations.
