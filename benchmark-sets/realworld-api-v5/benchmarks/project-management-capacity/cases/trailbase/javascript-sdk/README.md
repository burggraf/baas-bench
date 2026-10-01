# TrailBase JavaScript SDK — V5 candidate

**Unqualified; execution and publication are blocked.** Native Auth plus Record
API ACLs are the security boundary; client substitutions are not authorization.

SQLite candidate schema adds composite relationship/membership FKs, enums and
nonempty checks. Four native INSERT/UPDATE triggers insert one activity in the
same mutation transaction. Actions/subjects match the established PostgreSQL
contract, with server timestamps. Requests carry `last_actor_id`; create/update
ACLs must bind it to the authenticated application user. Null actors are reserved
for administrative import/reset, never accepted by authenticated mutation ACLs.
Update column allowlists protect tenant/identity fields. Project changes require
managers; comment changes require their author or a manager; user reads are self/peer.

Search uses the pinned native regexp filter with escaped literal text and
case-insensitive matching, not client filtering or an unqualified equality query.
Explicit null assignee filters are retained; timestamp ties use logical external
IDs. Missing totals fail. Pinned server 0.34.2 returns zero on empty beyond-end
pages; those pages obtain an additional native `limit=0,offset=0` exact-count query.
That fan-out is documented, not hidden or artificially imposed on other cases.

In-memory SQLite regressions execute constraints, ACL SQL and trigger rollback.
The bounded native smoke probe also exercised pinned Record API ACL/config parsing,
search, profile/password invariance, exactly-one activity on task update/comment
create/update, an injected trigger abort returning HTTP 500 with mutation/activity
rollback, complete logical fixture reset, and reread after a container restart.
The admin DB connection reported WAL, `synchronous=1` (NORMAL), and
`foreign_keys=1`. This restart check is not a power-loss guarantee; native measured
connection settings, search locale/metacharacters, wider adversarial cases and
full million-row identity restoration still need qualification. No V4 reset is reused.
