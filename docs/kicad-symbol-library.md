# KiCad schematic symbol library

## Product scope

Circuit Studio is a drafting and review workspace for sketches engineers can
carry into EasyEDA, KiCad, or another CAD tool. The symbol library makes
proposals more technically grounded; it does not turn Circuit Studio into a
full CAD editor. Users select symbols to guide the AI builder rather than
placing and wiring parts freely on the canvas.

The app checks drawing structure and selected known topology rules. It does not
simulate circuits, run a general electrical rules check, or certify correctness
or safety. Never describe a rendered draft as safe or ready to build.

## Source and distribution

- Source: KiCad's official schematic symbol library at
  <https://gitlab.com/kicad/libraries/kicad-symbols>.
- Pinned source version: `10.0.8` (`SOURCE_VERSION` in
  `artifacts/api-server/src/lib/kicadSymbols.ts`).
- The checked-in, compressed search index contains 22,911 symbols across 223
  KiCad libraries. The server and browser each use a copy of this compact
  metadata index.
- Full symbol definitions are fetched from the pinned official source only
  when a selected symbol is needed. They are parsed on the server and cached in
  memory. Do not copy the entire upstream library into the application bundle
  or claim that every full definition is available offline.
- The KiCad library's license and attribution notice is retained at
  `artifacts/circuit-studio/public/kicad-symbols-LICENSE.md`. Keep it with the
  project whenever the index or symbol data is redistributed.

Library search needs the local index. Loading a full symbol definition for a
new proposal also needs outbound access to the pinned KiCad source. If that
request fails, show an explicit error; do not silently substitute a Studio
symbol or make up pins. Once included in a saved circuit, the imported geometry
and pin data are part of that draft, so rendering it does not need another
library download.

## Data and rendering path

1. The authenticated component-library dialog searches the full local index by
   symbol name, ID, description, keywords, and library.
2. Selecting a KiCad result adds its exact `Library:Symbol` ID to the builder
   request. This is a request hint, not an instruction to draw or wire freely.
3. The API loads the source definition, resolves inherited symbols, and gives
   the model the exact units, body styles, pin numbers, names, and pin offsets.
4. The model returns a `kicad` CircuitSpec element with `symbolId` and `at`.
   The server attaches the trusted `symbolData`; the model must not author that
   field.
5. A saved element keeps `symbolId`, `unit`, `bodyStyle`, `rotation`, `flip`,
   and `symbolData`. Repairs remove the bulky geometry from model prompt input
   and reattach server-owned geometry before returning the proposal.
6. `CircuitDraw` uses the exact pin endpoints for connectivity, snap-to-pin,
   netlist, and build-sheet output. The source drawings and pin lines render
   from the imported geometry.

The KiCad parser currently converts polyline, rectangle, circle, arc, Bezier,
and text primitives into the renderer's compact geometry format. Pin numbers
and names remain distinct: netlist connections use the exact pin number when
present, with the library pin name retained for display.

## Rules for AI agents

- Use only an exact `Library:Symbol` ID returned by the library search or
  already present in the current CircuitSpec.
- Never invent a KiCad part's pin numbers, names, electrical type, or position.
  Use only the supplied unit and body-style definition.
- Do not return `symbolData` from the model. The API attaches the source data.
- When editing a saved draft, preserve unrelated KiCad elements and all their
  IDs, values, geometry, units, body styles, rotation, and flip state.
- Do not replace an unsupported KiCad symbol with a visually similar Studio
  symbol without telling the user.
- Keep symbol-library source/version and license notices aligned when updating
  the index. The `artifacts/api-server/data/` and
  `artifacts/circuit-studio/public/` index copies must remain identical.
- When adding parser features, test the parsed geometry and pin positions.
  When adding supported graphic primitives, update the parser, CircuitDraw
  renderer, validation, and tests together.
- Keep structural checks distinct from electrical simulation, safety review,
  and certification.

## Verification

Run the API parser tests and schematic renderer tests:

```sh
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/circuit-studio run test
```
