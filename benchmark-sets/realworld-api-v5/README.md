# Real-world API V5 — conformance-first remediation

**Status: implementation in progress; no case is admitted to run or publish.**

V5 is the active corrected definition approved on 2026-10-01 after the user
confirmed the multi-core handoff at clean revision `0e75c15`. V4 remains reference
source; any incomplete observations are diagnostic, not a fair ranking. No claim
is made that V4 has a qualified or published historical evidence series.

- [Approved observable contract](benchmarks/project-management-capacity/METHODOLOGY.md)
- [Eight-case audit and admission matrix](CONFORMANCE.md)
- [Repeatable native conformance procedures](NATIVE-CONFORMANCE.md)
- [Local conformance progress and authorization](LOCAL-CONFORMANCE.md)
- [Implementation plan](../../docs/plans/2026-10-01-baas-benchmark-fairness-plan.md)

The Supabase/TrailBase candidates contain initial native-policy, integrity,
activity, search/filter/count and profile repairs. Shared libraries are a small
independent snapshot of the established dataset/adapter machinery, not imports
from mutable or historical V4 runtime paths. Fixture IDs/password conventions
retain their existing spelling; that does not make V5 observations V3/V4 evidence.

`node --test test/realworld_api_v5_test.mjs test/native_conformance_v5_test.mjs`
executes protocol/fixture/reset regressions and
real in-memory SQLite constraints, ACL expressions and activity rollback. It does
not start a BaaS stack, certify native API execution, or test restart persistence.

`bin/bench validate all` validates definition format only. `bin/bench run` and
`bin/bench publish` explicitly reject V5, including dirty/debug overrides; hooks
also refuse direct execution. Remove these guards only after real-backend
conformance, full lifecycle restoration and measurement qualification are wired
and proved at a reviewed revision. No paid attempt or comparative publication is
authorized. Bounded integration resources/restarts need explicit authorization.
