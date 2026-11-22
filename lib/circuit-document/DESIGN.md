# CircuitDocument v2 design note

CircuitDocument v2 is an additive, versioned format. `electrical` owns
components, catalog-derived pin identities, nets, net membership, explicit
no-connects, and explicit unassigned pins. `drawing` owns the pixel canvas,
component placements, routes, junctions, crossing marks, and labels/boxes.

Connectivity is determined only by stable net IDs and pin membership. Net
display names are descriptive and never merge nets. Ground symbols remain
ordinary one-pin components: v2 only connects them when their pins share a net
ID. Repeated terminal labels have no electrical effect. A missing pin state is
not converted to a no-connect; v2 records it in `unassignedPins`.

Routes refer to existing net IDs and never change membership. Junction and
crossing marks refer to drawing routes only. Different-net routes can cross
without connecting; a same-net pair of pins remains connected even when its
drawing routes are incomplete. Validation reports schema, electrical, drawing,
and drawing-vs-electrical findings separately.

The legacy importer calls the existing CircuitDraw geometry/netlist path and
uses its exact pin/route membership report; it does not implement a second
coordinate-connectivity algorithm. Imported documents record that legacy
ground symbols were globally merged and repeated terminal labels were local.
Unresolved pins, structurally invalid geometry, duplicate identities, or
missing legacy membership reports block trusted conversion. Original input is
returned unchanged for recovery. The reverse projection supports only
documents whose component geometry and routes can be expressed without
inventing paths; it rejects explicit no-connect/unassigned states and separate
v2 ground nets that legacy CircuitSpec would merge.

KiCad pin IDs include the selected unit, body style, actual pin number/name, and
an occurrence index for duplicate definitions. This preserves duplicate pin
definitions without pretending their physical identities are interchangeable.
Legacy data that identifies only a repeated KiCad number ambiguously is not
reconstructed by inference.

## Unresolved decisions

- The v2 coordinate unit is currently fixed to pixels because the existing
  CircuitSpec renderer uses pixel coordinates. A future import/export to a CAD
  format with physical units needs an explicit unit conversion decision.
- Multi-unit KiCad symbols are represented per placed component instance and
  selected unit. Grouping several placed units into one logical package is not
  introduced here.
- Legacy projection refuses unassigned/no-connect pins and distinct ground
  nets because CircuitSpec has no safe way to preserve those distinctions.
- Warnings about incomplete visual routes are advisory for v2 itself, but such
  documents are not eligible for legacy projection.

## Persistence contract and session lifecycle

Phase 1B adds an explicit persisted-draft envelope:

- `legacy-circuit-spec` identifies the existing unversioned CircuitSpec value.
  Existing builder history rows and the existing `current_spec` JSON remain
  unchanged and authoritative when no v2 record exists.
- `circuit-document-v2` stores the complete `CircuitDocumentV2` under its
  existing `schemaVersion: 2`. Its `id`, electrical membership, symbol/pin
  identities, drawing data, and metadata are persisted as provided.

The shared runtime parser is the only persistence boundary that interprets
these representations. It validates the v2 schema and electrical/drawing
invariants on write and read. A legacy draft remains legacy; ordinary save/load
does not convert either representation. Mixed envelopes, malformed documents,
unknown envelope versions, and unknown document schema versions return
structured quarantine results and retain the original value for recovery.

Server-side v2 drafts are stored in the additive
`circuit_studio_v2_drafts` table, scoped by the verified Clerk `user_id` plus
`session_id`. The complete tagged envelope and its schema-version metadata are
written together with its independent storage revision. Reads use both
ownership keys. The internal service accepts an already-verified user ID, and
the API route derives that ID from Clerk auth rather than request data. This
table does not add a stale `current_spec` sidecar, so a v2 draft cannot be
replaced by an unrelated legacy spec. The existing
`/circuit-builder/history` route and its history contract remain legacy-only;
the ordinary workbench is not integrated with the separate V2 API. The isolated
Phase 1D V2 Draft Lab is a separate authenticated client and never writes to
legacy history.

Browser v2 drafts use a new user-scoped localStorage key and explicit envelope.
Existing CircuitSpec draft and history keys are neither migrated nor rewritten.
The v2 local adapter leaves malformed or unsupported stored text untouched.
The shared reconciliation helper compares local and server copies by
representation and complete document: identical copies resolve safely;
divergent copies are quarantined rather than chosen by write order. The current
workbench does not automatically sync v2 drafts. The isolated Draft Lab can
optionally use the V2 API only when its separate sync opt-in and the database
verification gate both allow it. If a caller supplies both legacy and v2
copies, the v2 representation is identified as authoritative, but restoration
waits for conflict handling.

There is no bulk migration of existing sessions. Missing v2 records continue to
mean the legacy session is authoritative; records are created only by an
explicit validated v2 save. Lossy or unavailable legacy projection does not
affect v2 storage or restore.

The current proposal flow still stages and applies legacy CircuitSpec values.
Future proposal lifecycle work can attach separate staged, applied, and
rejected `CircuitDocumentV2` snapshots keyed by proposal/revision identity,
without replacing the current draft until Apply. Undo/redo and proposal
revision history are not implemented in this phase.

### Verified legacy persistence paths

The existing `/circuit-builder/history` API continues to read and write the
legacy history table's `saved_state` and `current_spec`, scoped by Clerk
`user_id` and `session_id`. The v2 repository uses a separate table and never
updates those rows. If no v2 record exists for a session, the existing history
record remains the source of truth; there is no read-triggered import.

The ordinary workbench continues to save and restore its unwrapped legacy
`CircuitSpec` at `circuit-studio-draft-v1:<userId>`. The V2 Draft Lab uses the
separate `circuit-studio-document-v2-v1:<userId>` key, validates its tagged
envelope, and does not rewrite or delete the legacy key. Opening the Lab does
not import a legacy draft; import requires an explicit user action and a trusted
CircuitDraw membership report.

## Phase 1C authenticated V2 document API

The API is additive and remains separate from the legacy conversation-history
API:

- `GET /api/circuit-documents/v2/sessions/{sessionId}` returns either
  `{ "status": "empty" }` or a tagged V2 envelope with `schemaVersion`,
  `revision`, and ISO `updatedAt`. It queries only the V2 table for the
  authenticated Clerk user and session. An empty result never falls back to
  legacy history or imports a `CircuitSpec`.
- `PUT /api/circuit-documents/v2/sessions/{sessionId}` accepts only
  `{ "expectedRevision": number, "draft": taggedV2Envelope }`. Creation must
  use revision `0`; the response is the saved envelope with its new revision
  and update timestamp. A supplied `userId` or other unexpected top-level
  field is rejected.
- Authentication uses the existing Clerk middleware and `getAuth(req).userId`.
  The server derives the storage owner only from that verified request context.
  The composite `(user_id, session_id)` key and scoped SQL predicates prevent a
  session identifier from granting access to another account's copy.
- The document schema version inside the envelope is distinct from the
  database storage revision. A single insert with conflict-do-nothing creates
  revision 1; subsequent single-statement updates include the expected revision
  in their `WHERE` clause and increment it atomically. A stale update, missing
  row with a nonzero expected revision, or repeated create returns HTTP 409;
  it never overwrites the current row. Retrying a successful write with its old
  revision therefore conflicts rather than applying a duplicate write.
- Invalid, mixed, legacy, and unsupported documents return a typed error with
  safe path/message diagnostics and no partial write. Storage failures return
  a typed 503 response without database details. A quarantined stored record is
  reported as a typed 422 error; its raw value is not echoed.

Lifecycle:

```text
Client request
  → Clerk-authenticated route (user ID from request context)
  → generated request validation + V2 envelope/document validation
  → revision-aware persistence service
  → atomic user/session-scoped PostgreSQL insert or compare-and-update
  → typed loaded/empty/saved/conflict/error response
```

### Schema change and safe migration verification

The configured database adapter is Drizzle's PostgreSQL schema push, using
`drizzle-orm/node-postgres`. `pnpm --filter @workspace/db run push` is the
existing non-force schema command; `lib/db/drizzle.config.ts` selects
`NEON_DATABASE_URL` first and otherwise `DATABASE_URL`. Only run that command
after positively confirming that the selected URL points to an isolated,
disposable development database. Do not use `push-force` for this addition.

`lib/db/migrations/0001_circuit_studio_v2_drafts.sql` is an existing standalone
SQL reference file, not a journaled migration registered with Drizzle Kit.
Drizzle schema push does not execute that file. The SQL now matches the Drizzle
schema and includes an idempotent revision-column addition for older copies of
the V2 table. `pnpm --filter @workspace/db test` statically compares columns,
PostgreSQL types, nullability, defaults, ownership key, and safe/idempotent SQL
properties without connecting to a database.

Live table/migration verification remains **BLOCKED / NOT RUN** for this batch:
no isolated database could be identified from the local files without reading
or using the configured external connection. No database URL was inspected,
and no push, force push, or SQL migration was run. After an isolated development
database is confirmed, run the non-force `push` command above and verify the
resulting `circuit_studio_v2_drafts` columns and composite primary key with a
read-only schema query.

The generated OpenAPI Zod request contracts and React Query client are used by
the separate Lab's optional GET/PUT calls. The Lab defaults to local-only;
ordinary workbench generation, rendering, placement, routing, and exports do
not call these routes.

## Phase 1D isolated V2 Draft Lab

The signed-in workbench exposes `/studio/v2-drafts` only when
`VITE_ENABLE_CIRCUIT_DOCUMENT_V2_LAB=true`. The same authenticated Clerk user
context gates direct route access. This route is an isolated, read-only
workspace: legacy import is explicit, uses the trusted CircuitDraw membership
report, and assigns a new V2 document ID and independent V2 session ID. It
shows electrical membership, no-connect/unassigned pins, drawing counts, model
diagnostics, and a preview only when `projectCircuitDocumentToLegacy` proves
the projection lossless. That preview uses CircuitDraw and is labelled as
legacy-compatible, not a native V2 renderer.

The Lab restores only the signed-in user's V2 envelope. Local writes go through
the existing validator and V2 key; a missing V2 record never triggers an
automatic legacy import. Corrupt or unsupported local values stay quarantined.
If local and server drafts differ, the Lab keeps both and requires an explicit
choice. A stale server revision triggers one GET to learn the current server
copy, followed by a conflict choice; it never retries the failed PUT
automatically.

Optional server access requires both
`VITE_ENABLE_CIRCUIT_DOCUMENT_V2_SERVER_SYNC=true` and verified database
readiness. The code-level readiness remains false until an isolated development
database has been checked for the V2 table. Therefore the current built-in
configuration cannot perform V2 server writes, even if the sync flag is set.
The SQL reference is still not registered as a Drizzle journaled migration,
and no database query or schema push was performed for Phase 1D.

This phase does not add cross-device V2 session discovery, document editing,
generation, native rendering, export, layout, routing, or migration of legacy
history. The ordinary workbench continues to use CircuitSpec for all existing
generation, editing, history, drawing, and export behavior.
