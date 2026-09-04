CREATE TABLE bb_basic_js_v2_guestbook (
  id INTEGER PRIMARY KEY,
  author TEXT NOT NULL CHECK(length(author) BETWEEN 1 AND 32),
  message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 256),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  fixture_key INTEGER UNIQUE
) STRICT;

CREATE INDEX idx_bb_guestbook_created_at
  ON bb_basic_js_v2_guestbook (created_at DESC);
