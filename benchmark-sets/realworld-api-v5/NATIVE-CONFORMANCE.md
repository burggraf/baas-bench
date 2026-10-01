# Repeatable native conformance (candidate, not admission)

V5 execution and publication remain blocked. A successful small-fixture probe
is diagnostic evidence only: it cannot satisfy declared-scale fixture integrity,
complete Auth/session reset, or measurement qualification.

## Shared observable assertions

`shared/lib/native-conformance.mjs` exports `runNativeConformance` for both native
drivers. It uses the same session API for known-result literal/case searches,
ordered page/count/null-filter edges, live manager promotion/demotion, and
application-only profile changes checked against native Auth state. Role/comment
and profile mutations are restored even when an assertion fails. Drivers must
still reset activity and all other case-owned state after these checks.

Inputs are native `owner`/`member` sessions; a fixture with tenant/task/comment/
membership IDs, ordered `taskIds`, ordered `unassignedTaskIds`, and matching and
nonmatching `{query, ids}` searches; and a native `readAuthState` callback. Auth
state may include sensitive fields for in-process comparison but is never
included in the returned report. The `checks` map supplies the remaining raw API,
integrity, activity/rollback, fixture/reset and persistence assertions named in
`shared/lib/conformance.mjs`. Missing checks fail. Adapter success does not prove
raw native API authorization.

Regression command (no real services):

```sh
node --test test/native_conformance_v5_test.mjs test/realworld_api_v5_test.mjs
```

## Disposable TrailBase probe

Only run with explicit local-integration authorization. Requires Docker, Node
22+, the V5-pinned TrailBase image already present, and the pinned SDK install:

```sh
mkdir -p .runtime/conformance-v5/sdk
chmod 700 .runtime/conformance-v5 .runtime/conformance-v5/sdk
cp benchmark-sets/realworld-api-v5/shared/package*.json .runtime/conformance-v5/sdk/
npm ci --ignore-scripts --prefix .runtime/conformance-v5/sdk
node test/native_v5_trailbase_probe.mjs --local-disposable
```

The procedure creates a unique private run directory and uniquely named container,
uses a dynamically allocated localhost-only port and a 2-CPU/4-GiB limit, applies
candidate schema/ACLs, and installs the private failure trigger by migration.
It never connects to an existing stack or opens the live database with an external
SQLite writer. It removes only its own container/depot, including on failure.
A bounded readiness/restart check is included; database settings are recorded,
without a power-loss durability claim. Cleanup failure is recorded and remains
nonzero even if native assertions pass. An abrupt controller kill may require
manual cleanup using that run's private `inventory.json`; do not infer ownership
from a container name alone.

`report.json` stays under the ignored `.runtime/conformance-v5/trailbase-*/`
directory. `local_checks_passed` means the implemented synthetic assertions passed;
`conformance.passed` remains false because `fixture-integrity` and `reset-baseline`
are intentionally unimplemented at declared scale. No native qualification or
benchmark admission is implied. The probe is not part of automatic shell tests.

## Disposable Supabase probe

With the same SDK installation and explicit local-integration authorization:

```sh
node test/native_v5_supabase_probe.mjs --local-disposable
```

This uses `bin/baas setup` with a fresh private `BAAS_RUNTIME_DIR` and the V5
version profile. It never starts/stops the normal environment. The generated
Compose config removes global container/network/volume names and all host ports
except a fresh localhost gateway port. It pins Envoy, creates a fresh database,
regenerates credentials, limits the owned stack to at most 4 CPUs/8 GiB, and
starts only already-local images (`--pull never`). It reads native Auth state
only in memory. Cleanup removes its project containers/volumes and private source
and resolved config; the private report/inventory remain. Cleanup failure retains
private config for ownership-based manual recovery. No raw database or Auth state
is printed or committed.

The two drivers use identical fixture search/page expectations and activity
assertions. Both intentionally leave declared-scale fixture/reset evidence
missing; their reports cannot admit a case. The Supabase source fetch and local
setup are network operations, not paid Linode provisioning.

## Pending
- Expand adversarial coverage, including actual membership removal on a live
  session (the current role check covers promotion/demotion only), protected
  identity-column writes, and the remaining value/relationship corpus.
- Add complete fixture identity and Auth/session reset checks at declared scale.
- Qualify reset/verify/identical-warm-up/measure integration and bind native
  evidence to frozen definitions before reconsidering either hard guard.
