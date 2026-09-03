# Local BaaS Environments Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Build reproducible setup, isolated lifecycle, and smoke-test tooling for eight self-hosted BaaS systems.

**Architecture:** A dependency-free POSIX shell CLI fetches pinned upstream Compose deployments into `.runtime/` and operates both those stacks and three small committed Compose projects. Starting one stack first stops every benchmark stack, preserving volumes while isolating compute and memory.

**Tech Stack:** POSIX shell, Docker Compose v2, curl, git, OpenSSL

---

### Task 1: Record versions and CLI contract

**Files:**
- Create: `versions.env`
- Create: `.gitignore`
- Create: `test/baas_test.sh`

**Steps:**
1. Write a shell test asserting the exact eight-service list, rejection of unknown names, and stop-before-start ordering using fake `docker` and `curl` executables.
2. Run `sh test/baas_test.sh`; expect failure because `bin/baas` does not exist.
3. Add only enough CLI structure to pass list and validation assertions.
4. Run the test and expect PASS.

### Task 2: Add local Compose services

**Files:**
- Create: `services/directus/compose.yml`
- Create: `services/pocketbase/compose.yml`
- Create: `services/pocketbase/Dockerfile`
- Create: `services/trailbase/compose.yml`

**Steps:**
1. Add Directus using the official Postgres + Redis + Directus topology and pinned Directus/Postgres versions.
2. Add PocketBase using the official release-archive Docker pattern and architecture-aware build argument.
3. Add TrailBase using its official versioned image.
4. Run `docker compose config --quiet` for each file; expect success.

### Task 3: Implement pinned upstream setup

**Files:**
- Modify: `bin/baas`
- Modify: `test/baas_test.sh`

**Steps:**
1. Extend the failing test to assert `setup` invokes a pinned fetch and validates Compose.
2. Add idempotent sparse checkout for Supabase, Neon, and Nhost.
3. Add immutable raw-file downloads for Convex and Appwrite.
4. Generate ignored local secrets and replace upstream `latest` image references where required.
5. Run `sh test/baas_test.sh`; expect PASS.
6. Run `bin/baas setup all`; expect eight valid Compose projects.

### Task 4: Implement lifecycle and smoke checks

**Files:**
- Modify: `bin/baas`
- Modify: `test/baas_test.sh`

**Steps:**
1. Verify the ordering test fails before lifecycle implementation.
2. Implement `start`, `stop`, `status`, and `smoke` through Docker Compose.
3. Implement bounded readiness retries in `start`.
4. Use service-specific HTTP, GraphQL, or SQL smoke calls.
5. Run `sh test/baas_test.sh`; expect PASS.

### Task 5: Integration verification and documentation

**Files:**
- Create: `README.md`

**Steps:**
1. Start, smoke, and stop each service one at a time.
2. Record any Apple Silicon or upstream limitations in the README.
3. Run `sh test/baas_test.sh` and `bin/baas setup all` again.
4. Confirm `bin/baas status` reports no running benchmark stacks.
5. Commit and push the repository to `burggraf/baas-bench`.
