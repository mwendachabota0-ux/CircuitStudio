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
