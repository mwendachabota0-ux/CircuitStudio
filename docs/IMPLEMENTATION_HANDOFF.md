# CircuitStudio local implementation handoff

**Audit date:** 2026-11-22

**Scope:** Read-only review of the local workspace, tests, builds, and current application wiring. This audit did not change application code, configuration, dependencies, database state, or remote repositories. It creates this handoff file only.

## Workspace snapshot and provenance

- The supplied reconciliation note says this workspace was imported from downloaded project files. That origin was not independently verified.
- Local Git metadata is present: branch `main`, commit `203630c6a137ae9811f78e6e9104c253ef5b03c4`, tracking `origin/main`, with no local ahead/behind count reported. The worktree was clean before this handoff was created.
- No remote was contacted, fetched, or compared. Treat the current local checkout as the source of truth until the user directs otherwise.
- `CircuitStudio-architecture-audit.txt` is historical, not a current implementation checklist. Its claims that topology validation depends on circuit titles and its test counts are stale; current source and tests show the title-independence repair described below.

## Current implementation status

| Area | Status | Finding |
| --- | --- | --- |
| Phase 0: retry and topology safeguards | **VERIFIED** | Implemented and covered by current regression tests. |
| Phase 1A: V2 circuit document model | **VERIFIED** | Shared model, validation, legacy adapters, fixtures, and round-trip tests exist. |
| Phase 1B: V2 persistence foundation | **VERIFIED** | Versioned local/server persistence code and a separate database table definition exist; these are not connected to the live workbench. |
| Development database migration/table | **BLOCKED** | The SQL file exists, but the migration is not registered in the configured migration workflow and table existence was not verified. No database was changed. |
| Live V2 API and workbench integration | **NOT STARTED** | Generation, editing, history, drawing, and exports still use legacy `CircuitSpec`. |
| Deterministic placement, automatic routing, V2 generation/rendering | **NOT STARTED** | No such implementation was found. |

### Phase 0 — verified

Relevant code and tests:

- `artifacts/circuit-studio/src/lib/circuit-build-retry.ts`
- `artifacts/circuit-studio/src/lib/circuit-build-retry.test.ts`
- `artifacts/circuit-studio/src/lib/circuit-regression-fixtures.test.mjs`
- `artifacts/circuit-studio/public/circuit-draw.js`
- `artifacts/circuit-studio/src/lib/fixtures/`

The astable-flasher fault checks classify circuit structure rather than reading the title. They look for a recognizable two-transistor, capacitor-feedback topology and then report faults such as tied bases or incorrect feedback. Tests confirm that the same base-short finding is produced under descriptive and neutral titles, and that an unrelated shared-base switch is not mislabeled as an astable.

Build retries use an immutable original snapshot, restore protected non-wire component data, and track actual retry counts. Circuit and pin-to-net signatures protect connectivity during ordinary repair and layout-repair attempts; repairs are rejected when the baseline or candidate connectivity cannot be trusted. The explicit wire-rebuild recovery path is allowed to change connections because rebuilding them is its purpose. This protection is based on the legacy drawing/netlist representation, not on the V2 model being active in the workbench.

Regression coverage also includes preserving component properties and positions, route-only changes, disconnected or merged nets, retry exhaustion, and retaining a rejected proposal when a repair fails.

### Phase 1A — verified

Relevant code and tests:

- `lib/circuit-document/src/model.ts`
- `lib/circuit-document/src/validation.ts`
- `lib/circuit-document/src/legacy.ts`
- `lib/circuit-document/test/fixtures/v2-fixtures.mjs`
- `lib/circuit-document/DESIGN.md`

The strict V2 document has distinct electrical and drawing representations. Electrical data includes stable component and pin identities, explicit net membership, no-connects, and unassigned pins. Drawing data includes placements, geometry, routes, junctions, crossings, and annotations. Validation separates schema, electrical, drawing, and consistency findings.

Legacy import uses CircuitDraw's existing netlist membership instead of inferring connectivity independently. Projection back to legacy refuses cases that would lose meaning, including explicit no-connects or unassigned pins, separate ground nets that legacy behavior would merge, incomplete routes, and changed pin-to-net membership. Fixture-backed tests cover topology, crossings, pin identity, ground behavior, and safe projection boundaries.

### Phase 1B — persistence code verified; database deployment blocked

Relevant code:

- `lib/circuit-document/src/persistence.ts`
- `artifacts/api-server/src/lib/circuitDocumentDraftService.ts`
- `artifacts/api-server/src/lib/circuitDocumentDraftRepository.ts`
- `lib/db/src/schema/`
- `lib/db/migrations/0001_circuit_studio_v2_drafts.sql`

The persistence envelope records its format, envelope version, and whether the payload is legacy or V2. V2 drafts use a separate user-scoped browser-storage key and a separate `circuit_studio_v2_drafts` table keyed by user and session. Server service/repository code validates V2 writes and reads, scopes records to the signed-in user, and quarantines malformed, mixed, or unsupported documents rather than silently downgrading them. Local/server reconciliation rejects divergent copies.

The database schema and SQL define the same V2 draft fields and composite user/session key. However, `lib/db/migrations/` contains only the SQL file and no Drizzle journal/registration metadata; `lib/db` scripts expose `push` and `push-force`, not a registered SQL migration runner. A current offline check,

```sh
env NEON_DATABASE_URL= DATABASE_URL=postgres://offline:offline@127.0.0.1:1/offline \
  pnpm --filter @workspace/db exec drizzle-kit check --config ./drizzle.config.ts
```

stopped at Drizzle's AWS Data API configuration validation (`database` was missing; `secretArn` was interpreted as `postgresql`). It did not connect to a database. The configured application database is external Neon, and no safe read-only connection for that database was available in this audit. Therefore, the V2 table's presence in the development database is **unverified**. No migration, schema push, or database query was run.

## Live application wiring

The current application remains legacy-first:

- `artifacts/api-server/src/routes/circuits.ts` generates legacy `CircuitSpec` output. `artifacts/api-server/src/routes/circuitBuilder.ts` accepts and returns legacy circuit proposals.
- `artifacts/circuit-studio/src/App.tsx` uses `CircuitDraw.render`, validation, netlist, and sheet-building functions with `CircuitSpec`. The workbench draft remains in the legacy `circuit-studio-draft-v1:${userId}` local-storage slot.
- Builder proposals are staged for review and only replace the draft after the user applies them. Account history stores legacy `currentSpec` snapshots and restores them through the same legacy path.
- The V2 persistence service is not exposed through an authenticated V2 draft API route and is not called by the workbench. V2 browser storage is not the live draft store.
- SVG/PNG, JSON, BOM, and technical-document exports are produced from the current legacy `CircuitSpec`; there is no V2-aware renderer or export pipeline.
- The schematic viewport supports pan/zoom/fit/fullscreen, but pointer handling is for panning. Direct canvas component placement, moving, deletion, and wire drawing were not found; edits are made through the structured draft/AI proposal paths.
- Tutor image input exists, but no dedicated V2-aware visual-versus-electrical schematic review was found.

## Architectural work still outstanding

All items below are **NOT STARTED** unless noted:

- **Deterministic component placement:** AI output supplies component coordinates; current layout analysis reports overlaps but does not place or reposition parts algorithmically.
- **Automatic wire routing/pathfinding:** AI output supplies route coordinates. CircuitDraw auto-fixes a narrowly defined set of endpoint/tail issues; there is no obstacle-avoiding router or A* implementation.
- **Collision avoidance and route optimization:** current checks warn about overlapping bodies, labels, and wires. They do not automatically resolve collisions or optimize routes.
- **V2-aware generation and rendering:** model/API contracts and the live renderer still use legacy `CircuitSpec`.
- **General electrical rule checking:** there are targeted topology and structural checks, including astable-flasher checks, but no general-purpose ERC.
- **Circuit simulation:** none found.
- **Direct canvas editing:** none found beyond viewport controls.
- **Dedicated visual review:** image-capable Tutor behavior exists, but not a standalone review that compares a schematic image/render with V2 electrical connectivity.

## Verification performed

All commands below were run against the current local checkout. Results:

| Check | Result |
| --- | --- |
| `pnpm --filter @workspace/circuit-document test` | **PASS** — 65 tests |
| `pnpm --filter @workspace/api-server test` | **PASS** — 65 tests |
| `pnpm --filter @workspace/circuit-studio test` | **PASS** — 110 tests |
| `pnpm run typecheck` | **PASS** — workspace libraries, API, Studio, sandbox, and scripts |
| API production build | **PASS** — `build.mjs` ran from a temporary copy with workspace dependencies linked; output stayed under `/tmp` and was removed |
| Web production build | **PASS** — Vite output directed to `/tmp`; emitted a non-blocking warning that the minified JS chunk is 925.92 kB, above the 500 kB warning threshold |
| `curl --fail --silent --show-error --max-time 10 http://localhost:80/api/healthz` | **PASS** — `{"status":"ok"}` |
| Database migration/table check | **BLOCKED** — offline Drizzle CLI configuration validation failed before any database connection |

No signed-in browser interaction or end-to-end UI test was performed. Build/test outputs were kept outside the workspace where applicable. The worktree was clean after verification and before creating this file.

## Recommended next batch — not started

Complete **development-only V2 draft persistence integration** before beginning placement or routing work:

1. Confirm which migration mechanism is authoritative for the Neon development database and verify the V2 table with an approved read-only check. Do not run a schema push or migration against production.
2. Add authenticated, versioned V2 draft read/write endpoints using the existing service and repository. Keep existing legacy endpoints and history behavior unchanged.
3. Add API tests for authorization/user scoping, malformed and future versions, preservation of the last valid draft on failed saves, and local/server divergence.
4. Add an explicitly controlled client save/restore path that keeps legacy drafts intact, quarantines conflicts, and never silently converts or overwrites a legacy session.

**Acceptance criteria:** the development table is confirmed or safely established through the project's chosen workflow; signed-in users can save and restore a V2 draft through authenticated endpoints; another user's session cannot be read or overwritten; invalid/future/divergent data remains recoverable; existing legacy save, history, generation, rendering, and export behavior continues to pass its current tests. Keep V2 rendering/generation and automated placement/routing out of this batch.
