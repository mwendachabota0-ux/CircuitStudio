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

## Phase 2B-1 shared geometry and placement-lock contract

`@workspace/circuit-geometry` exposes one resolver for stable pin identities
and coordinates, body bounds, text bounds, and the effective transform.
CircuitDraw and the V2 geometry adapter share the same pin and KiCad transform
functions. Unsupported source geometry is explicit; it is not treated as an
empty obstacle.

For V2, component properties remain authoritative for symbol and pin geometry.
Placement rotation/flip and legacy endpoint geometry are adapted explicitly;
conflicting copies in `placement.properties` are rejected. Placement-owned
label settings remain supported and are passed to the shared text resolver.
Built-in body/text bounds follow CircuitDraw's supported symbols and text
layout. Terminal label bounds conservatively cover possible wire-dependent
label sides, and text glyph extents remain measured estimates.

The optional `placement.userPinned` flag is backward compatible. Pure
`resolvePlacementMobility` decisions protect existing placements in
`place-unplaced`, protect unmarked legacy placements in `preserve-pinned`,
allow explicitly unpinned placements in that mode, and require `reflow` to
move existing unpinned placements. Explicit user pins, request pins, and fixed
positions remain protected. `getPlacementRouteImpact` only reports the nets,
routes, and unrouted multi-pin nets affected by proposed movement; it never
changes a placement or route. Legacy CircuitSpec projection warns when either
explicit lock value would be lost.

`routeCircuitDocument` is the separate, pure V2 route operation. It uses
explicit net membership and shared resolved pin/body geometry, adds routes only
to nets without existing routes, and preserves the rest of the document.
Per-net failures are atomic; branch junctions and clean different-net crossings
are explicit drawing annotations. It does not repair manual routes or add a UI,
API, database integration, or electrical simulation. See
`docs/CIRCUIT_LAYOUT_ENGINE_DESIGN.md` and the Batch 9 checkpoint in
`docs/IMPLEMENTATION_HANDOFF.md` for its limits and verification.

## Phase 3B placement and routing composition

`prepareCircuitDocumentDrawing` in `drawing-preparation.ts` is the pure
orchestration entry point. It accepts a V2 document, optional existing layout
hints and routing options, and the required
`circuit-drawing-preparation/1` algorithm version. It validates the input,
calls `layoutCircuitDocument` in protected `place-unplaced` mode, passes the
resulting document to `routeCircuitDocument`, and validates the routed result.
It reuses both engines; it does not introduce a second placement or routing
algorithm.

The operation changes only `drawing`. It preserves the complete electrical
model, all pre-existing placements and lock fields, and existing routes,
junctions, crossings, annotations, canvas settings, and metadata. The router
skips nets with any existing route; this pipeline does not extend or repair
manual routes. If a manual route remains incomplete or a routing result is
incomplete, the pipeline returns `partial` with diagnostics rather than
overwriting drawing data. Invalid input, blocked placement, and blocked routing
have separate result statuses; `complete` means the structure is valid, all
eligible unrouted multi-pin nets were routed, and no residual consistency
warnings remain.

The result carries stage statuses, placement metrics, routed/skipped/blocked
net IDs and counts, and a stable deduplicated set of stage and final-validation
diagnostics. It is deterministic for the same document and options and does
not mutate the input. This is a library operation only: it is not called by the
live workbench, and a complete drawing is not a claim of electrical
correctness, simulation, or safety.

Known router limits still apply. Bounded A* may return an incomplete result for
dense layouts, and the existing single-transistor fixture's control net can be
blocked by `route-collinear-overlap`; the pipeline reports that result without
changing the router or existing manual routes. V2 preview/workbench integration
is the next separately scoped dependency.

## Batch 11 Phase 4A V2 electrical generation

The API server exposes a separate authenticated
`POST /api/circuit-documents/v2/generate` operation. Its OpenAPI contract accepts a
user description and returns a staged `{ status: "proposed", document, design,
validation }` result. The model supplies only electrical intent: supported
components and their properties, stable net IDs, exact component-pin
memberships, explicit no-connect/unassigned states, a concise summary,
assumptions, uncertainties, and material questions.

The server treats model output as untrusted. It rejects unsupported component
types, duplicate identities, unknown or contradictory pin references,
incomplete pin states, malformed data, and drawing geometry (including
geometry-bearing compound property names). It derives canonical pins from
`getCircuitPinDefinitions`, builds a V2 document with a stable ID and an empty
drawing section, and validates the result before returning it. The result is
not persisted or applied, and this operation does not call
`prepareCircuitDocumentDrawing`.

Generation reuses the existing Gemini `gemini-2.5-flash` client, account-usage
tracking, key fallback, rate limit, and request authorization. A
`MAX_TOKENS` response is continued once from its partial output using the
existing lower-thinking-budget retry, starting after the key used by the
truncated attempt. Prompt/response lengths, finish status, token counts, and
document counts are logged without logging raw prompt or model text.

The API reports structural validation only; it does not establish electrical
correctness, ERC compliance, simulation, component ratings, or safety. Native
rendering and workbench integration remain separate work. A future V2 flow may
submit the staged electrical document to the deterministic drawing-preparation
pipeline for a distinct drawing proposal; legacy CircuitSpec generation and
behavior remain unchanged.
