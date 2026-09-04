# TrailBase Rust WASM

HTTP requests call a Rust WASM component loaded by the pinned TrailBase deployment. The component executes the shared SQL operation against TrailBase's embedded SQLite database using `trailbase_wasm::db::query`. This is an extension path, not a direct client database connection.
