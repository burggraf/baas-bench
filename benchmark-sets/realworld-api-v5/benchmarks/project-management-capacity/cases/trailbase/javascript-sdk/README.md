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

In-memory SQLite regressions execute constraints, ACL SQL and trigger rollback,
not the live Record API/config parser. Native FK/ACL behavior, search locale,
server response-before-commit, full fixture restoration/auth mapping on repeat
setup, process-restart persistence, durability settings and measured request/write
amplification still need bounded integration proof. No V4 incomplete reset is reused.
