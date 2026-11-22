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
written together in one transaction. Reads use both ownership keys. The
internal service accepts an already-verified user ID; any future route must
derive that ID from Clerk auth rather than request data. This table does not
add a stale `current_spec` sidecar, so a v2 draft cannot be replaced by an
unrelated legacy spec. The existing `/circuit-builder/history` contract and
generated client remain legacy-only; the v2 persistence service is internal
until a later workbench integration.

Browser v2 drafts use a new user-scoped localStorage key and explicit envelope.
Existing CircuitSpec draft and history keys are neither migrated nor rewritten.
The v2 local adapter leaves malformed or unsupported stored text untouched.
The shared reconciliation helper compares local and server copies by
representation and complete document: identical copies resolve safely;
divergent copies are quarantined rather than chosen by write order. The current
workbench does not automatically sync v2 drafts yet. If a caller supplies both
legacy and v2 copies, the v2 representation is identified as authoritative,
but restoration waits for conflict handling.

There is no bulk migration of existing sessions. Missing v2 records continue to
mean the legacy session is authoritative; records are created only by an
explicit validated v2 save. Lossy or unavailable legacy projection does not
affect v2 storage or restore.

The current proposal flow still stages and applies legacy CircuitSpec values.
Future proposal lifecycle work can attach separate staged, applied, and
rejected `CircuitDocumentV2` snapshots keyed by proposal/revision identity,
without replacing the current draft until Apply. Undo/redo and proposal
revision history are not implemented in this phase.
