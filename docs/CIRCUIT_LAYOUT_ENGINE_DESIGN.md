# Circuit Studio V2 Deterministic Placement Engine

**Batch:** 6 — Phase 2A
**Status:** Phase 2A design checkpoint. Phase 2B-1 geometry/policy helpers and the Phase 2B-2 deterministic placement core are implemented in the records below.
**Evidence boundary:** Current local workspace only. No remote repository, package registry, database, or external source was accessed.

## Executive summary

CircuitDocumentV2 already separates electrical membership from schematic drawing. That is the right foundation for automatic placement: the engine can arrange symbols using explicit component-pin-to-net membership, without guessing connectivity from wire coordinates, labels, component names, or proximity.

The recommended design is an immutable, deterministic, rule-assisted **hypergraph + layered placement** pipeline:

1. Validate the V2 electrical model and resolve canonical pin and conservative body/text geometry.
2. Build connected subcircuits from component IDs, stable pin IDs, and **net IDs**. Keep each net as a multi-terminal hyperedge; do not merge nets by display name.
3. Use explicit layout hints and trusted component/pin roles to establish flow direction where possible. Use deterministic fallback ordering for unknown roles.
4. Collapse directed feedback cycles into strongly connected components (SCCs), place the resulting groups on stable grid-aligned ranks, then pack symbols using their actual resolved bounds and pin anchors.
5. Return placements, metrics, diagnostics, and a conservative route-impact report. Never generate or edit routes.

The safest default is **place unplaced**: existing placements are immutable. Reflow is an explicit operation. A future placement-lock field is needed to distinguish user-pinned symbols from generated ones; old unmarked placements must be treated as protected outside an explicit reflow.

The key implementation prerequisite is not a graph package. It is one trustworthy geometry contract. The current shared geometry package supplies canonical pin positions, while body bounds and some text-collision estimates live privately in the legacy renderer. Placement, pin anchors, bounds, and text clearance need to be resolved together and consistently before automatic placement can be safe.

The design is limited to the isolated V2 document path. Phase 1D remains a read-only lab, server sync stays gated, and the ordinary CircuitSpec workbench remains unchanged.

## 1. Verified current architecture

### 1.1 CircuitDocumentV2 model

The source of the schema is `lib/circuit-document/src/model.ts`, especially `CircuitDocumentV2Schema` and `getCircuitPinDefinitions`.

| Field | Verified meaning and authority |
| --- | --- |
| `electrical.components` | Electrical-model components keyed by stable `id`, with supported `type`, optional `reference`/`value`, an open `properties` record, and stable `pins`. The shared catalog derives ordinary pin IDs; a resolved KiCad unit derives IDs from selected unit/body style, pin number/name, and duplicate occurrence. The component properties that select a KiCad symbol/unit are required to derive canonical pins. |
| `electrical.nets` | Each net has an authoritative stable `id`, exact `members` (`componentId`, `pinId`), optional display `name`, and optional `attributes`. A net name is descriptive; equal names do not merge nets. |
| `electrical.noConnects` | Explicitly intentional unconnected pin references. |
| `electrical.unassignedPins` | Pin references whose connectivity has not been assigned. They are not implicit no-connects. |
| `drawing.units` / `drawing.canvas` | Units are currently fixed to `"px"`; width and height are optional positive values. |
| `drawing.placements` | At most one placement per component; a placement is not required for every component. It contains `position`, finite `rotation`, `flip`, optional compatibility `legacyGeometry` (`from`, `to`, `at`), and an open `properties` record. |
| `drawing.routes` | Visual paths with stable route ID, authoritative `netId`, pixel points, optional `open`, and properties. They do not define V2 electrical membership. |
| `drawing.junctions` / `crossings` | Drawing annotations that refer to route IDs and positions. They cannot merge or split electrical nets. |
| `drawing.annotations` | Labels and boxes. They are visual only. |
| `metadata` / `legacyImport` | Optional document-level metadata and legacy-import semantics. Neither changes net membership. |

`lib/circuit-document/src/validation.ts` defines the current model checks:

- `validateElectrical` requires each canonical pin to appear exactly once across net membership, no-connects, or unassigned pins. It rejects duplicate or invalid pin references and checks stored pin definitions against `getCircuitPinDefinitions`.
- `validateDrawing` checks placement references/uniqueness, route net references, segment warnings, and whether junction/crossing route references are geometrically plausible.
- `checkCircuitDrawingConsistency` computes world pin points and reports drawing-versus-electrical warnings; these warnings do not make `isValid` false.
- `arePinsElectricallyConnected` looks up shared net membership. It does not use coordinates or net display names.

Consequently, the placement engine must preserve the whole `electrical` object, not merely net connectivity. This includes component properties, stable pin definitions, net attributes, no-connects, and unassigned pins.

### 1.2 Placement and compatibility-field semantics

The present model contains two representations of placement geometry. They are not interchangeable:

- `legacy.ts` `componentPlacement` sets the placement origin to a legacy `at` coordinate, or to the midpoint of `from`/`to`. For a two-terminal part it records the endpoint-derived angle as `rotation` when no rotation was supplied, but also preserves both endpoints.
- `validation.ts` `worldPinPoints` combines component properties with `placement.legacyGeometry`; it falls back to `placement.position` for `at`, then applies placement `flip` and `rotation` through the shared geometry helper.
- `legacy.ts` `legacyElementFromComponent` uses `legacyGeometry.from/to` for two-terminal parts and `legacyGeometry.at` for KiCad symbols. Other at-based built-ins can fall back to `position`.
- Two-terminal pin locations are exactly `from` and `to`. For these parts, the preserved endpoints—not `position` and `rotation` alone—currently determine pin coordinates.
- At-based built-in parts use catalog offsets around `at`; current non-KiCad geometry does not apply a general rotation transform. `flip` changes pin offsets only for the catalogued transistor and FET types. `opamp`/`comparator` use the explicit `swap` property for their inputs.
- KiCad symbols use `at` as the symbol origin and apply horizontal mirror followed by rotation. The selected `unit` and `bodyStyle` determine which pin/graphic set is active.

`legacyGeometry` is therefore compatibility data with concrete effects on pin coordinates and legacy projection, not disposable cache data. `position`, `rotation`, and `flip` are drawing placement fields, but the current code does not define one universal transform for every component type. The future engine must resolve type-specific geometry and keep the compatibility representation synchronized.

There is also a duplicated-property hazard. Legacy import places geometry-affecting source data such as KiCad symbol data in `component.properties` and may copy it to `placement.properties`; `legacyElementFromComponent` spreads placement properties after component properties. Canonical pin identities are checked from component properties, while a legacy preview could receive an overriding placement copy. Future geometry resolution should make component symbol identity/data authoritative and either reject conflicting geometry-affecting placement properties or remove that duplication in a separately reviewed schema migration.

### 1.3 V2 lifecycle and isolation

The implementation was checked in:

- `artifacts/circuit-studio/src/lib/circuit-document-v2-lab.ts`: feature-flag and access helpers, explicit legacy-copy creation, independent identities, local-first save, and session-pointer handling. `CIRCUIT_DOCUMENT_V2_DATABASE_VERIFIED` remains `false`.
- `artifacts/circuit-studio/src/components/circuit-document-v2-lab.tsx`: local restore, explicit trusted import, validation diagnostics, local save, optional gated server operations, and preview.
- `lib/circuit-document/src/legacy.ts`: `importLegacyCircuitSpec` relies on CircuitDraw's exact pin/route membership report; `projectCircuitDocumentToLegacy` rejects unsupported/lossy projection instead of fabricating routes.
- `lib/circuit-document/DESIGN.md`: the existing persistence and Phase 1D isolation contract.

The Phase 1D lab is a separate authenticated, feature-flagged, read-only workspace. It can make a separate V2 copy only after an explicit user action and trusted CircuitDraw membership report. It validates and saves V2 locally; optional server sync remains disabled unless separately opted in and database readiness is verified. The shown preview is a labeled **legacy-compatible projection**, not a native V2 renderer. Projection is blocked when consistency checks find incomplete visible wiring, unsupported no-connect/unassigned states, or V2 ground distinctions that legacy CircuitSpec would lose. The standard workbench and its legacy draft/history remain separate.

There are no V2 placement controls, native V2 renderer, route generator, or automatic placement call sites in this lab.

### 1.4 Existing graph/layout/collision utilities

The local manifests, lockfile, source imports, and installed workspace package search did not find an application-used graph or diagram-layout library such as ELK, Dagre, Graphology, Cytoscape, or D3 Force. The one installed package matching a broad `cola` search was Orval's unrelated Pinia Colada package. No package should be added for Phase 2A.

Reusable local foundations:

- `@workspace/circuit-geometry` is the shared schema/pin geometry package.
- `CircuitDraw` exposes structural validation, netlist membership, and `layoutWarnings` for the legacy `CircuitSpec` path.
- `CircuitDraw.layoutWarnings` is a diagnostic pass, not a placer. It detects approximate body overlap/clearance, wires through bodies, and text collisions. It does not move parts, model V2 placement modes, or calculate route impact.
- V2 validation and pin-membership tests already protect electrical invariants; they do not test placement output.

## 2. Geometry and renderer audit

### 2.1 Canonical pin geometry

`lib/circuit-geometry/src/index.ts` owns `CIRCUIT_COMPONENT_REFERENCE`, supported element types, `getCircuitElementSchemaError`, and `getCircuitPins`.

- Two-terminal types use ordered pins at exact `from` and `to` coordinates. Their symbol bodies are drawn along that endpoint vector.
- Multi-pin built-ins use explicit type-specific local offsets around `at`; some support a horizontal flip, while most do not support generic rotation.
- `ic` and `connector` pin anchors are calculated from ordered left/right pin lists and their side counts.
- KiCad pin endpoints come from the exact selected symbol unit/body style. `getCircuitPins` mirrors the local x-coordinate when `flip` is true, rotates, translates by `at`, and rounds final coordinates to two decimals.
- `CircuitDraw.pinsOf` delegates to `CircuitGeometry.getCircuitPins`, so the renderer and V2 pin-coordinate checker share built-in pin positions.

For KiCad, the renderer separately implements `transformKicadPoint` and `kicadTransform` in `artifacts/circuit-studio/public/circuit-draw.js`. Its order is also x-mirror then rotation then translation; SVG output coordinates are rounded for rendering. This appears aligned today but duplicates transform code and can drift.

### 2.2 Symbol bounds and text

The renderer has separate `TWO_BODY_BOUNDS` and `MULTI_BODY_BOUNDS` tables, plus special bounds for `ground`, `antenna`, `terminal`, `ic`, and `connector`, and a dynamic `kicadBodyBounds` path. This covers the known built-in symbol families when their required geometry is present. It is not a shared, typed contract and is not consumed by `CircuitDocumentV2` validation or pin definitions.

Reliability differs by geometry type:

- Two-terminal bounds are built around the endpoint vector by transforming a local rectangular body bound. This is more orientation-aware than simply adding a box to the placement origin.
- Most multi-pin bounds are fixed axis-aligned boxes at `at`; the bounds path does not apply a generic rotation transform.
- KiCad body bounds use selected-unit graphics or, if no graphic points are available, transformed pin body points. `polyline`, rectangle and Bézier control points, circle radius, and text estimates are used; arc extrema, stroke width, exact font metrics, and some primitive extents are not fully represented.
- The generic `ic`/`connector` body box is estimated from left/right pin counts.
- `componentBodyBounds` returns `null` when it cannot resolve a supported shape. A placer must treat this as an explicit unsupported-geometry condition, not silently omit the component as an obstacle.

Body bounds are not complete rendered-ink bounds. `layoutWarnings` separately collects text boxes from `textEl` for ordinary labels, values, and KiCad pin names/numbers and compares them with other text and wires. These text boxes use a character-count width estimate. Text embedded directly in KiCad `symbolData` graphics is rendered by `drawKicadGraphic` rather than `textEl`, so it is not included in that separate text-collision pass. Labels, pin names, and text are not consistently unioned into the body bounds.

The geometry source is therefore split: shared catalog pin coordinates; renderer-local standard symbol artwork and approximate bounds; and imported KiCad source graphics plus independently duplicated transforms. No evidence supports treating all current visual bounds as exact.

### 2.3 KiCad units and unknown geometry

`KicadSymbolData` stores an ID and a list of `{ unit, bodyStyle, pins, graphics }`. Each V2 KiCad component's canonical pins are generated for the selected unit/body style; stable IDs include unit, body style, pin number/name, and occurrence so duplicate definitions remain distinct. The current design explicitly models a selected unit per placed instance; it does not group multiple units into one package instance.

The V2 fixture set contains a synthetic single-unit KiCad symbol with duplicate pin definitions. Legacy tests also verify a resolved single-unit symbol and block an unresolved symbol. There is no true multi-unit or alternate-body-style placement fixture. `getCircuitElementSchemaError` permits `symbolData` to be absent at the geometry-schema layer, but V2 pin derivation then fails; trusted legacy import also refuses unresolved pin identities. The placement engine must require resolved, selected-unit pin and body geometry and return a diagnostic for missing/unsupported bounds. It must not infer a footprint or pinout from a symbol ID or display name.

### 2.4 Minimum geometry contract before placement

A future shared resolver should return one coherent, immutable geometry record for a component plus a placement transform:

- stable pin ID to transformed pin anchor, preserving duplicate pin identities;
- symbol/body bounds in document pixels, preferably conservative polygons or rectangles;
- separately measured text bounds for reference, value, pin names/numbers, and embedded symbol text;
- pin lead/access direction or access corridor for future orthogonal routing;
- explicit geometry source and confidence (`catalog`, resolved KiCad source, or unsupported);
- selected KiCad unit/body style and transform, when applicable;
- a clear failure when any required pin/bounds/text input cannot be resolved.

The resolver must make the same transform authoritative for V2 consistency diagnostics, collision checks, the future native preview, placement, and later routing. Existing renderer-private helpers are evidence and possible starting points, not a safe API as-is.

## 3. Representative V2 topology evidence

`lib/circuit-document/test/fixtures/v2-fixtures.mjs` contains 16 structural fixtures. Existing `model.test.mjs`, `legacy.test.mjs`, and `projection.test.mjs` exercise many of their invariants. They are topology/layout inputs, not proofs of electrical functionality.

| Fixture pattern | Placement implication |
| --- | --- |
| Series LED | Simple source → switch → resistor → LED path; ordered stages can form a left-to-right baseline when no hints conflict. |
| Parallel branches | Supply/return hyperedges with two separate load branches; branches should align and share explicit rails without duplicating or merging net membership. |
| Single-transistor switch | Active stage with control and return relationships; types alone do not prove electrical correctness. |
| Two-transistor astable and base-short variant | Feedback/cyclic cross-coupling is valid graph structure; a deliberate base short remains one explicit net, not something layout “repairs.” |
| Non-connecting crossing nets | Two different net IDs may cross visually; their geometry must not become a graph edge. |
| Shared multi-pin branch | One net may join more than two pins; use a hyperedge, not pairwise independent nets. |
| Separate and shared grounds | A ground symbol is a one-pin component; only shared net membership connects grounds. Distinct ground net IDs remain distinct even if both are named `GND`. |
| Duplicate display names | Matching net names do not merge net IDs. |
| No-connect and unassigned pins | Keep explicit state distinct; neither creates a graph edge. Still place and draw the component without hiding the pin. |
| KiCad duplicate pins | Duplicate pin definitions retain separate IDs and anchors; the selected unit/body-style geometry is mandatory. |
| Far-apart same-net pins | Electrical connectivity remains true without a visible route; placement cannot convert coordinate coincidence into membership or silently claim routed completeness. |
| Conflicting visual junction | A junction annotation cannot merge different net IDs. |

Important coverage gap: add real multi-unit, alternate body-style, rotated/flipped KiCad, high-fanout, isolated-subcircuit, and unresolved-bounds placement cases before the engine is accepted.

## 4. Algorithm evaluation and recommendation

### 4.1 Options

| Approach | Strengths for this project | Risks / limits | Recommended use |
| --- | --- | --- | --- |
| Deterministic rules | Predictable; can apply source/input/active/output roles, branch alignment, grid, clearances, and user hints. Easy to explain and test. | Brittle if every component must be classified; hand-written special cases can grow without a stable geometry contract. | Use for role hints, grouping, stable fallback, and hard schematic constraints—not as an exhaustive list of circuit recipes. |
| Layered graph (Sugiyama-style) | Readable signal flow and ranked stages; stable ordering can reduce edge crossings for acyclic sections. | Real circuits contain feedback; direction is often unknown; treating every multi-terminal net as pairwise edges overweights branches. | Use after role/direction inference for rank assignment and ordering. Collapse directed SCCs before laying out layers. |
| Bipartite component/net graph or hypergraph | Directly represents explicit V2 membership; naturally preserves multi-pin nets and distinguishes duplicate names/grounds by ID. | A single high-degree hub can dominate a layout if naïvely converted to a star; hypergraph alone does not define signal direction or symbol constraints. | Use as the topology model. Keep each net ID as its own hyperedge; normalize/cap high-fanout influence during ordering. |
| Force-directed graph | Can expose clusters when relationships are weakly structured. | Randomness/initialization reduces reproducibility; large fanout pulls groups together; no symbol-size, pin-access, grid, or orthogonal-routing guarantees; layout can change drastically from tiny input changes. | Do not use as the primary or default schematic placer. A deterministic force pass is not a substitute for hard constraints. |
| Existing reusable libraries | Could supply graph traversal or ordering pieces if a suitable dependency already exists. | The local workspace has no graph/diagram-placement library declared or used; generic diagram layouts do not know circuit pin anchors or stale-route constraints. | Reuse local geometry/validation only. Do not add a dependency in this phase. Reassess only if implementation benchmarks demonstrate a concrete gap. |

### 4.2 Recommended hybrid pipeline

1. **Validate and resolve geometry.** Require an electrically valid V2 document and a supported geometry record for every component to be placed. Preserve the existing electrical model exactly.
2. **Build the topology by identity.** Create one component node per component ID and one hyperedge per net ID, with its stable pin references. Derive connected subcircuits strictly from membership. Do not use route coordinates, names, types, labels, or proximity to create connectivity.
3. **Classify only with evidence.** Use explicit per-component/user hints first. Use catalog category and known pin semantics for a low-confidence role suggestion only. KiCad pin `electricalType` can help when present. Net names such as `VCC`, `GND`, or repeated signal labels are display text, not relationship evidence. Keep unknown-role components in stable connected groups.
4. **Orient only known flow.** For supported roles, produce a directed stage graph and apply the requested direction (default recommendation: left-to-right). Leave uncertain relationships unordered rather than inferring them from labels.
5. **Collapse directed feedback SCCs.** Treat each strongly connected component as one rankable group. Preserve member order using stable IDs and reserve a feedback lane/clearance area; placement does not route the loop.
6. **Rank and order deterministically.** Use a layered rank assignment for the directed acyclic condensation graph. Apply bounded, deterministic median/barycenter sweeps with stable-ID tie breaks to reduce crossings. Avoid complete all-pairs expansion of high-fanout nets; normalize their ordering weight by fanout.
7. **Pack using real bounds.** Place each component's symbol/text footprint on a configured grid with minimum clearances, pin access, space for future orthogonal routes, and fixed/pinned obstacles. Align parallel branches where possible. Arrange disconnected subcircuits as separate, stable clusters.
8. **Score and validate.** Enforce hard constraints first (valid transform, supported geometry, no body/text collision, locked coordinates, canvas constraints). Use readability, branch structure, estimated route complexity, and compactness as soft objectives. Run geometry and V2 consistency checks after producing a candidate.
9. **Return a proposal.** Return a new document only when it is safe to apply; otherwise return diagnostics and candidate placements for review without mutating input. Report routes affected by moved components and nets requiring new visual connections. No wire paths are produced.

### 4.3 Difficult topology cases

- **Power/input/processing/output:** Apply these groups only when explicit hints or trustworthy component/pin metadata supports them. A small, versioned role catalog for common symbol types can provide defaults, but results must remain overridable and must not be described as electrical validation.
- **Unknown roles:** Preserve connected-subcircuit grouping, use stable component IDs for ordering, and avoid fabricated source-to-output direction.
- **Feedback:** Use SCC condensation for rank ordering; keep the feedback group together and reserve an outer loop lane for the later router.
- **Multi-branch/high-fanout nets:** Keep one hyperedge per net ID and place branch consumers in aligned rows/columns when helpful. Limit hub weight by a fanout-aware formula; do not create all pairwise component links.
- **Separate grounds:** Do not combine distinct ground IDs. Their visual proximity may be an explicit layout hint, but it never makes them electrically connected.
- **Repeated names:** Never merge same-name nets. Keep net names as optional annotations only.
- **Multi-unit KiCad:** Treat each currently modeled selected unit as its own component placement. Do not invent package grouping. If grouping is later needed, add explicit package/group identity and fixtures first.
- **No-connect/unassigned pins:** Exclude them from the connectivity graph. Keep them visible and return warnings/metrics so layout does not imply an intentional connection.
- **Isolated/disconnected parts:** Place each disconnected component/subcircuit deterministically in a separate cluster; do not infer a missing net.

## 5. Placement quality objectives

Use a lexicographic priority, not one opaque weighted score:

1. **Safety and hard validity:** preserve all electrical state; preserve pinned/fixed positions; resolve every placed symbol; do not overlap symbol bodies or protected text; satisfy explicit canvas constraints; never commit stale routed geometry.
2. **Schematic readability:** group related stages, preserve recognizable feedback and parallel branches, and use signal-flow direction only when known.
3. **Future routability:** expose pin anchors, maintain access corridors, reserve branch/feedback space, avoid unnecessary crossing risk, and keep high-fanout connection areas open.
4. **Alignment and stability:** snap eligible origins to a versioned grid, align comparable stages, and use stable ID tie-breaks.
5. **Compactness:** reduce canvas area only after readability, clearance, and routability goals are met.

Proposed first-pass tunables are a 10 px origin grid and at least 12 px body clearance, with additional label/pin-access margins from the geometry resolver. These are starting defaults, not proof of visual quality; tune them from rendered review and fixture measurements. Do not snap pin endpoints independently of component geometry.

## 6. Proposed pure API and data contract

The following is a design sketch, not source code. Keep the function in a V2 document/layout module and keep it independent from browser state, storage, React, CircuitDraw rendering, and network calls.

```ts
type PlacementMode =
  | "place-unplaced"
  | "reflow"
  | "preserve-pinned";

type LayoutHints = {
  direction?: "left-to-right" | "right-to-left" | "top-to-bottom" | "bottom-to-top";
  gridPx?: number;
  bodyClearancePx?: number;
  routeCorridorPx?: number;
  pinnedComponentIds?: string[];
  fixedPositions?: Record<string, [number, number]>;
  groups?: Array<{ id: string; componentIds: string[]; order?: string[] }>;
  componentRoles?: Record<string, "source" | "input" | "active" | "output" | "unknown">;
  netRolesById?: Record<string, "power" | "return" | "signal" | "unknown">;
  canvasPolicy?: "respect-existing" | "allow-overflow";
};

type PlacementRequest = {
  document: CircuitDocumentV2;
  mode: PlacementMode;
  hints?: LayoutHints;
  algorithmVersion: "circuit-layout/1";
};

type LayoutMetric = {
  componentCount: number;
  unplacedBefore: number;
  movedExisting: number;
  bodyOverlapCount: number;
  minimumClearanceViolationCount: number;
  textCollisionCount: number;
  canvasOverflowCount: number;
  estimatedManhattanWireLengthPx?: number;
  estimatedRouteComplexity?: {
    netsWithMoreThanTwoPins: number;
    excessFanout: number;
    feedbackGroups: number;
    blockedPinAccessCount: number;
  };
  runtimeMs: number;
};

type RouteImpact = {
  movedComponentIds: string[];
  affectedNetIds: string[];
  affectedRouteIds: string[];
  unroutedNetIds: string[];
  requiresRerouting: boolean;
};

type PlacementResult =
  | {
      status: "complete";
      document: CircuitDocumentV2;
      diagnostics: CircuitDocumentDiagnostic[];
      metrics: LayoutMetric;
      routeImpact: RouteImpact;
      algorithmVersion: "circuit-layout/1";
    }
  | {
      status: "blocked";
      candidatePlacements?: CircuitDocumentV2["drawing"]["placements"];
      diagnostics: CircuitDocumentDiagnostic[];
      metrics?: LayoutMetric;
      routeImpact?: RouteImpact;
      algorithmVersion: "circuit-layout/1";
    };

function layoutCircuitDocument(
  request: PlacementRequest,
): PlacementResult;
```

Contract requirements:

- Treat the input as immutable and return a new document; never edit the caller's object or stored draft in place.
- Preserve `electrical` exactly. Tests should deep-compare a canonical electrical-state snapshot before/after, including properties, pin definitions, net attributes/membership, no-connects, and unassigned pins.
- Modify only eligible drawing placements and explicitly approved layout metadata. Do not create/delete/merge/rename nets, alter pin membership, or change routes/junctions/crossings/annotations.
- Return stable diagnostic `code`, severity, path, and plain-language message. Include missing bounds, unsupported geometry, invalid input, impossible constraints, and route impact.
- Return sorted IDs and stable metric values. For exact repeated inputs and version/config, placements and diagnostics must match.
- Keep algorithm/config version in the result; persist it as layout metadata only after a future schema decision. Do not silently reinterpret old generated layouts under a new algorithm version.
- When fixed canvas width/height is insufficient, return overflow diagnostics unless the caller explicitly permits overflow. If dimensions are absent, report computed extents; do not silently rewrite unrelated canvas data.
- `estimatedManhattanWireLengthPx` and `estimatedRouteComplexity` are heuristics only. The former is the sum of per-net Manhattan minimum-spanning-tree lengths between resolved pin anchors, ignoring obstacles. The latter is a transparent vector of high-fanout nets, excess terminals (`sum(max(0, memberCount - 2))`), feedback groups, and blocked pin-access corridors. Neither is actual route geometry or electrical simulation.

### Placement-mode semantics

| Mode | Required behavior |
| --- | --- |
| `place-unplaced` | Safest default. Preserve every existing placement structurally and place only components without one. If an existing placement has unsupported geometry, leave it unchanged and report it; do not “fix” it as a side effect. |
| `reflow` | Explicitly authorize rearranging existing placements. A component explicitly marked/passed as pinned remains fixed. If routes are affected and no router is part of the operation, return `blocked` with candidate placements and route IDs; do not commit a stale document. |
| `preserve-pinned` | Keep pinned/fixed components exactly where they are and arrange eligible unpinned/unplaced components around them. Pinned symbols are hard obstacles. |

The current placement schema has no user-pinned/generated distinction. The smallest future additive schema field is optional `drawing.placements[].userPinned`. New generated placements set it to `false`; users can set it to `true`. For backward safety, an old placement with the field absent is treated as protected in `preserve-pinned`; a user must explicitly request `reflow` to move legacy placements. Explicit request-level `pinnedComponentIds` and `fixedPositions` override the field for one operation. This schema addition is not part of Phase 2A.

## 7. Route-staleness and preview policy

V2 routes contain `netId` and points, but no stable pin-endpoint references. Therefore a placer cannot reliably tell which route endpoint was intended for which pin by net ID alone. Moving any component pin on a net with routes conservatively affects **all** routes for that net.

Recommended safe policy:

1. `place-unplaced` never changes any existing component placement or route. It separately reports `unroutedNetIds` where a newly placed pin has no visible route/coincident same-net pin. It does not claim the schematic is fully routed.
2. For reflow, collect nets containing pins on moved components and all route IDs on those nets. With no router available, return a blocking `layout-routes-stale` diagnostic and candidate placements only. The operation must not save moved positions with old paths as if complete.
3. When a future router exists, route regeneration and placement must be one explicit, atomic operation: new placements and replacement paths validate together; only that router may create or edit route points.
4. Never repair an affected route in the placement engine. Preserve original route objects byte-for-byte in a successful non-moving operation.
5. Re-run `checkCircuitDrawingConsistency` after candidate placement. If visual connectivity warnings remain, keep the document marked/informed as incomplete and do not show a fully routed preview.

Existing safety evidence: `projectCircuitDocumentToLegacy` rejects V2 documents with consistency warnings instead of fabricating paths, and the Phase 1D lab shows only a clearly labeled legacy-compatible preview when that projection succeeds. It is not a native V2 preview or persistent stale-route state. The future UI should surface `affectedRouteIds`, `unroutedNetIds`, and a visible “layout requires routing” diagnostic; it must not present stale geometry as final.

## 8. Determinism requirements

- Sort component IDs, net IDs, pin IDs, connected-subcircuit IDs, and stable tie-break candidates before every order-sensitive step.
- Never depend on random numbers, current time, browser rendering order, object insertion order, locale-dependent comparison, or map iteration as an implicit tie-break.
- Use a documented stable string comparator and quantize score comparisons with a versioned tolerance.
- Use fixed iteration limits and deterministic convergence/stop conditions for ordering sweeps.
- Ensure stable IDs survive input array reordering. A test that permutes component/net array order must yield the same component-ID-to-placement map.
- Include algorithm version and normalized effective configuration in the reproducibility contract. If geometry catalog or bounds version changes, bump a geometry/layout compatibility version or explicitly invalidate previous generated layouts.
- On an impossible constraint or missing required geometry, return a deterministic diagnostic; do not fall back to random placement or silently omit the part.

## 9. Test and benchmark plan

### 9.1 Test matrix

| Area | Cases and acceptance |
| --- | --- |
| Determinism | Repeat identical requests; shuffle input arrays; assert the same sorted component-ID-to-placement map and diagnostics for the same algorithm/config version. |
| Electrical invariance | Snapshot the entire `electrical` section before/after all successful and blocked calls; require deep equality, including attributes and explicit pin states. |
| Existing placements | `place-unplaced` leaves all existing placements unchanged. Reflow moves only permitted components. Pinned IDs/fixed positions remain exact. |
| Geometry and collision | Test every supported body family, body/text clearance, canvas overflow, grid placement, and impossible fixed constraints. Require zero body overlaps on successful output. Treat unresolved bounds as a diagnostic, never as an empty obstacle. |
| Transforms | Compare resolved pin anchors and body bounds with the canonical geometry/renderer for two-terminal orientation, built-in `flip` and `swap`, KiCad rotation and flip, and boundary angles. |
| Feedback/cycles | Use the astable fixture plus a complete routed/cross-coupled variant; verify SCC grouping, stable loop placement, and unchanged base-short membership. |
| Branches/high fanout | Use parallel branches and shared multi-pin branch; add a high-fanout net. Verify branches stay distinct and the net remains one hyperedge without same-name joins. |
| Net identity | Separate/shared grounds and duplicate display names stay separate/shared exactly according to net IDs. Crossings and junction annotations do not alter graph connectivity. |
| Pin states | No-connect and unassigned pins stay distinct, visible, and unconnected by the placer. |
| KiCad | Add multi-unit, alternate body style, duplicate pins, transformed pins, embedded text, arc/Bezier bounds, and unresolved-symbol/bounds fixtures. Unsupported cases block deterministically. |
| Disconnected/isolated parts | Separate subcircuits remain distinct; isolated components receive stable positions without fabricated connections. |
| Routes | Place-unplaced preserves route points and reports new incomplete nets. Reflow with routes on moved-component nets blocks and lists all affected route IDs. Reflow without affected routes can succeed. No placement test may accept silently stale routes. |
| Failure behavior | Invalid electrical input, missing geometry, duplicate IDs, impossible canvas/locks, or resolver errors return diagnostics and leave the source object and all stored state unchanged. |
| Existing V2 path | Run the existing model, legacy import, projection, persistence, and Phase 1D lab tests unchanged to prove isolation. |

Start with the current `v2-fixtures.mjs` corpus and legacy series/parallel/crossing projection fixtures. The current corpus has no multi-unit symbol or layout-geometry matrix, so add those before using it as an engine acceptance suite.

### 9.2 Metrics and review

Measure at least:

- body-overlap count and minimum body-clearance violations;
- text and pin-label collision count, with text-estimation confidence noted;
- canvas overflow count and total occupied bounds;
- grid alignment deviation and count of preserved/pinned placements;
- number of moved existing components;
- `unroutedNetIds`, affected route IDs, and fanout distribution;
- estimated Manhattan connection length (per-net Manhattan MST lower bound without obstacles) and a route-complexity vector: high-fanout net count, excess terminals, feedback groups, and blocked pin-access corridors. Label these as estimates, not generated wiring;
- deterministic stability across repeated/permuted inputs;
- runtime by component/pin/net count, using fixed synthetic sizes and the representative fixture corpus.

Pure unit tests can verify IDs, invariants, transforms, bounds, overlaps, stable output, route-impact sets, and runtime measurements. Visual review is still required for readability, text clearance, feedback-loop grouping, parallel branch alignment, and whether estimated bounds match rendered symbols. Do not treat screenshot review as a substitute for structural tests.

### 9.3 Initial acceptance gates

A candidate placement is eligible to apply only when:

1. The full electrical snapshot is unchanged.
2. Every newly placed component has resolved pin anchors and usable conservative bounds.
3. No body overlap or explicit hard-constraint violation remains.
4. All protected positions remain unchanged.
5. Any moved component with existing routes either has those paths replaced atomically by a separate future router or causes a blocking result.
6. Validation produces no schema/electrical/drawing errors; any visual-connectivity warning is reported and prevents “fully routed” presentation.
7. Repeated and input-permuted runs satisfy the deterministic contract.

## 10. Phased implementation plan

1. **Phase 2A — design (this batch):** document the verified model, geometry gaps, algorithm, API, safety rules, tests, and boundaries. No source implementation.
2. **Phase 2B — geometry/placement contract:** introduce a shared component-geometry resolver with stable pin anchors and conservative symbol/text bounds; resolve duplicate property authority; add the optional user-pinned contract with backward-safe defaults. Add resolver fixtures/tests before any automatic movement.
3. **Phase 2C — pure placement core:** implement a deterministic topology/hypergraph projection, role hints, SCC handling, rank/order/packing, immutable results, diagnostics, and structural/benchmark tests. Keep it isolated from UI and legacy CircuitSpec.
4. **Phase 2D — route-impact gate and lab proposal UI:** expose explicit modes, candidate review, pinned controls, diagnostics, and safe local save only in the V2 lab. Keep legacy workbench untouched; block routed reflow until routing exists.
5. **Phase 2E — routing integration (separate design/authorization):** this was the planned boundary before Batch 9 authorized the standalone route generator. Any UI or placement-plus-routing lifecycle remains separately scoped; do not widen the placement engine into a route repair tool.
6. **Later — native V2 rendering and export:** consume the same geometry resolver and display warnings consistently; keep preview provenance visible until it is native.

## 11. Risks and open questions

### Risks

- Separate geometry tables can drift from rendered artwork, especially for text, arcs, custom KiCad graphics, and unsupported symbols.
- `position`/`rotation` and `legacyGeometry` can disagree; `placement.properties` can duplicate and override geometry-affecting component properties during legacy projection.
- The current route schema has no pin endpoint identities, so route-impact analysis must be conservative at net granularity.
- Component-role rules may imply signal direction that the electrical model does not prove. Hints and role confidence must remain visible.
- Treating a high-fanout net as ordinary pairwise edges can make it dominate the layout; use a hyperedge-aware orderer.
- Existing import/renderer behavior may have user-authored geometry that should not be moved without explicit consent.
- Current bounds and label estimates are not exact; successful software metrics still need visual review.

### Open decisions before implementation

1. Confirm preferred default flow direction and whether 10 px grid / 12 px initial body clearance suit Circuit Studio's renderer.
2. Decide how users mark an existing placement as unpinned for `preserve-pinned` while retaining safe behavior for old documents.
3. Decide which built-in component roles are sufficiently trustworthy for default stage ordering and how role confidence is surfaced.
4. Decide whether a future package/group identity is needed to keep multiple KiCad units together. The present schema has no such grouping.
5. Define how conflicts between `component.properties`, `placement.properties`, and `legacyGeometry` are migrated or rejected.
6. Before a router is designed, decide whether routes should gain stable endpoint pin references; net ID alone cannot prove intended endpoint ownership.

## 12. Out of scope

- Implementing or prototyping placement, graph traversal, geometry resolution, collision logic, or layout UI in Phase 2A.
- Changing source code, tests, schemas, package manifests, dependencies, migrations, database configuration, API routes, or build files.
- Generating, rerouting, repairing, or changing wire paths; adding junctions or crossings.
- Changing any electrical component, pin identity, net ID, net membership, no-connect, unassigned pin, or electrical metadata.
- Claiming circuit correctness, electrical simulation, safety review, or component-rating validation.
- Connecting V2 to the ordinary CircuitSpec workbench, enabling V2 server sync, or changing database state.
- AI image generation/redrawing, remote source lookup, deployment, or repository synchronization.

## 13. Evidence index

- `docs/IMPLEMENTATION_HANDOFF.md` — prior Phase 1D checkpoint, current isolation and verification status.
- `lib/circuit-document/DESIGN.md` — V2 electrical/drawing separation, persistence, projection, KiCad ID rules, and Phase 1D boundary.
- `lib/circuit-document/src/model.ts` — `CircuitDocumentV2Schema`, placement/route schemas, `getCircuitPinDefinitions`, `createCircuitComponent`.
- `lib/circuit-document/src/validation.ts` — `validateElectrical`, `validateDrawing`, `worldPinPoints`, `checkCircuitDrawingConsistency`, `validateCircuitDocumentV2`.
- `lib/circuit-document/src/legacy.ts` — `componentPlacement`, `importLegacyCircuitSpec`, `legacyElementFromComponent`, `projectCircuitDocumentToLegacy`.
- `lib/circuit-geometry/src/index.ts` — `CIRCUIT_COMPONENT_REFERENCE`, `getCircuitElementSchemaError`, `getCircuitPins`, `KicadSymbolData`.
- `artifacts/circuit-studio/public/circuit-draw.js` — `pinsOf`, KiCad transforms, symbol drawing, body-bound tables, `componentBodyBounds`, and `layoutWarnings`.
- `artifacts/circuit-studio/src/lib/circuit-document-v2-lab.ts` — V2 isolation, feature flags, copy creation, local-first save, and server-readiness gate.
- `artifacts/circuit-studio/src/components/circuit-document-v2-lab.tsx` — explicit import, read-only summary/diagnostics, and safe legacy-compatible projection.
- `lib/circuit-document/test/fixtures/v2-fixtures.mjs` — actual V2 structural fixture contents.
- `lib/circuit-document/test/model.test.mjs`, `legacy.test.mjs`, `projection.test.mjs` — existing topology, import, transform-identity, and safe-projection assertions; no placement-engine test exists.
- `artifacts/circuit-studio/src/lib/circuit-document-v2-lab.test.ts` — isolated V2 lab access, local persistence, and guarded sync tests.

No source files, test files, dependencies, database state, or remote repositories were changed or accessed for this design assignment.

## Phase 2B-1 implementation record

Phase 2A remains a design-only checkpoint. The following records the later
Phase 2B-1 implementation without changing the original Phase 2A scope:

- `@workspace/circuit-geometry` now exposes a shared resolver for stable pin
  identities and transformed anchors, component body bounds, and text bounds.
  It reuses the canonical pin resolver and existing renderer geometry rather
  than adding a second placement engine. Unsupported KiCad source geometry
  returns an explicit unsupported result.
- The V2 geometry adapter takes symbol/pin geometry from the component and its
  explicit placement transforms. It passes placement-owned label settings
  through the resolver, but rejects conflicting compatibility geometry rather
  than allowing arbitrary placement properties to shadow the component.
- The renderer-aligned bounds cover the supported built-in symbol families,
  two-terminal endpoint orientation, KiCad transforms and text/pin labels,
  embedded symbol text, and IC/connector pin names. Terminal-label bounds are
  conservative because final side selection depends on connected wire
  direction. Text measurements follow CircuitDraw's character-width and
  baseline conventions; they are still estimates of rendered glyph extents.
- The optional placement `userPinned` field remains backward compatible.
  Mobility decisions are pure: existing placements stay protected in
  `place-unplaced`; `preserve-pinned` treats an absent legacy flag as
  protected, while explicit `false` opts out; `reflow` is the explicit
  authorization to move existing unpinned placements. Request-level pins and
  fixed positions take precedence.
- Route impact is deterministic and report-only: it lists moved components,
  affected nets/routes, unrouted multi-pin nets, and whether rerouting would be
  required. It does not move a component or edit routes, junctions, or
  crossings. Legacy projection warns when either explicit `userPinned` state
  would be lost.
- No automatic placement, graph ordering, wire routing, UI, API/database
  integration, or validator behavior was added or changed in Phase 2B-1.
  Phase 2B-2 later added the separate deterministic placement core; Batch 9
  subsequently added the separately scoped V2 routing operation.

## Phase 2B-2 deterministic placement implementation

The library now exports a pure `layoutCircuitDocument` proposal function for
`CircuitDocumentV2`. It accepts the three placement modes and the versioned
layout hints/result contract. It parses and validates the V2 input, clones it,
and only replaces `drawing.placements`; the complete electrical object and all
existing routes, junctions, crossings, annotations, canvas dimensions, and
metadata are retained.

### Topology and placement

- Connected subcircuits are built from component-pin membership and stable
  **net IDs**, never display names or drawing proximity. Each net remains one
  hyperedge, including shared/high-fanout nets.
- Deterministic roles and pin-flow hints establish stable ranks. Feedback SCC
  members share a rank; connected groups are separated into stable rows, with
  stable ID tie-breaking and fixed iteration limits.
- The engine uses `resolveCircuitDocumentComponentGeometry` for pin positions,
  body bounds, and text bounds. It checks symbol/text collisions, body
  clearance, pin-access corridors, and existing canvas limits before accepting
  a placement. All newly placed origins are snapped to the requested grid.
- For a known two-terminal catalog type only, a new placement with no source
  endpoints may use the catalog's declared `minimumTerminalDistance` as its
  initial endpoint span. Existing or unknown geometry is never assigned
  invented bounds; unresolved geometry produces a diagnostic and blocks any
  operation that needs it as a movable part or obstacle.
- Existing placements are protected unless `userPinned: false` is explicit
  and the selected mode allows movement. Request-level pins/fixed positions
  become obstacles; an unplaced request-pinned component without a fixed
  position is blocked.

### Routes, results, and checks

- The engine never edits route points, junctions, or crossings. Moving an
  existing component conservatively marks every route on its nets as affected;
  without a router, it returns a blocked proposal with candidate placements
  and `layout-routes-stale`, rather than a completed document.
- New placements can report unrouted affected nets after the drawing
  consistency check. A successful proposal is not a claim that the circuit is
  fully routed or electrically simulated.
- Results include stable diagnostics, component/overlap/clearance/text/canvas
  metrics, topology counts, route-impact IDs, and `circuit-layout/1`.
- The focused tests cover repeatability and input-array permutation, exact
  electrical invariance, lock modes, overlaps and canvas limits, feedback and
  high fanout, duplicate display names, unsupported KiCad text bounds, route
  preservation/blocking, and empty/minimal/larger documents.

### Remaining limitations

- Candidate search is a deterministic expanding grid spiral capped at 80
  cells per component. Dense or constrained arrangements may be blocked even
  when a valid arrangement exists farther away; the diagnostic reports that
  no safe candidate was found within the bound.
- The layout uses topology ranks and feedback clusters, not a full general
  schematic optimizer. It does not reserve a dedicated feedback wire lane,
  optimize actual wire length, route wires, or infer circuit behavior.
- Body/text geometry is limited by the shared resolver's conservative
  estimates. Route corridors are geometric clearance estimates, not evidence
  that a future router will succeed.
- No UI, AI generation, persistence/database change, electrical simulation,
  route generation, or direct canvas editing is included in this phase.

## Batch 9 — Phase 3A deterministic wire routing

The V2 library now exports the pure `routeCircuitDocument` operation with
algorithm version `circuit-routing/1`. Its typed options default to a 10 px
grid, 12 px body clearance, a 24-cell search margin, and a 30,000-node bound
per branch connection.

- Electrical membership comes only from explicit net IDs and pin members.
  Single-pin nets and nets that already have routes are not edited; existing
  routes, junctions, crossings, placements, annotations, metadata, and the
  electrical model are retained.
- Exact pin anchors and conservative symbol body bounds come from
  `resolveCircuitDocumentComponentGeometry`. Orthogonal A* connects sorted net
  members into a route tree, allows a short cardinal pin escape through that
  pin's own body only, and keeps all other route segments outside body
  clearance.
- Each multi-pin branch joins the existing same-net tree with an explicit
  junction. Clean perpendicular crossings with another net receive a crossing
  marker; overlaps, endpoint touches, and ambiguous crossings reject that
  net's candidate rather than leaving visually ambiguous wiring.
- `complete` means the permitted pass finished; `incomplete` returns successful
  nets but no partial drawing for any failed net; `blocked` means the document,
  options, or algorithm version could not be accepted. Geometry, placement,
  no-path, and search-limit problems are explicit diagnostics.
- No-connect and unassigned pins are never selected as route terminals.
  Unresolved placed geometry blocks pending nets when it prevents safe
  obstacle clearance. The router does not alter existing manual routes or
  automatically repair/reroute them.

Verification:

The routing suite also exercises a deterministic eight-pin fanout tree,
checking exact pin endpoints, branch connectivity, and input immutability.

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --test lib/circuit-document/test/routing.test.mjs` | **PASS** — 12 routing tests |
| `pnpm --filter @workspace/circuit-document test` | **PASS** — 98 tests |
| `pnpm run typecheck` | **PASS** — libraries, API server, Circuit Studio, mockup sandbox, and scripts |
| `git diff --check` | **PASS** |

This phase adds the V2 library engine only; it does not connect routing to the
legacy workbench or add a route-preview UI. Geometry bounds remain
conservative estimates, and tight canvases or obstacle layouts can exhaust the
configured search envelope. Batch 10 below composes placement and routing at
the library level. No remote symbol library was accessed or downloaded for
this local-only implementation.

## Batch 10 — Phase 3B layout/routing preparation pipeline

`prepareCircuitDocumentDrawing` is a pure V2 operation that runs the existing
`layoutCircuitDocument` in protected `place-unplaced` mode, then passes its
document to `routeCircuitDocument`. Callers can supply the existing placement
hints and routing options; the pipeline does not expose reflow or a second
placement/routing implementation.

- The electrical model is never changed. Existing placements and lock fields,
  routes, junctions, crossings, annotations, canvas settings, and metadata are
  retained. The router adds routes only to eligible nets without existing
  routes.
- The result reports placement/routing stage states, placement metrics, route
  counts and IDs, combined deterministic diagnostics, and one of `complete`,
  `partial`, `invalid-input`, `placement-blocked`, or `routing-blocked`.
- Structural input errors stop before placement. A placement failure returns
  the original drawing; a routing failure returns the validated placement
  proposal without partial additions from a blocked net. Final structural
  validation errors prevent a completed result. Residual consistency warnings
  or a router `incomplete` result are reported as `partial`.
- Existing routed nets are not repaired or extended. A partial manual route
  remains unchanged and makes the overall result partial. Existing router
  limitations also remain; for example, the single-transistor fixture's
  control net is blocked by a collinear-overlap diagnostic.

The Phase 3B integration tests and exact verification commands are recorded in
the Batch 10 checkpoint in `docs/IMPLEMENTATION_HANDOFF.md`. The next
dependency is a separately scoped V2 preview/workbench integration; this
pipeline is not connected to the live UI.
