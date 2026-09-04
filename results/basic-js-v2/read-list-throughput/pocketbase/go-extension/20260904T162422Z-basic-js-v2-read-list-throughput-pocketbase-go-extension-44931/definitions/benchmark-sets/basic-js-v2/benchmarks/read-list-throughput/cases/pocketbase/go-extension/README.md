# PocketBase Go extension

HTTP requests call custom Go routes compiled into the pinned PocketBase deployment. Reads execute SQL through `app.DB()` against embedded SQLite; writes use PocketBase's internal record persistence API. This is an extension path, not a direct client database connection.
