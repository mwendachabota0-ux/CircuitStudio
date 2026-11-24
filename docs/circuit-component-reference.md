# Circuit Studio component compatibility reference

This reference mirrors the shared `CIRCUIT_COMPONENT_REFERENCE` used by the
renderer, AI prompts, and server-side type and required-property checks. `type` is exact
and case-sensitive. `id`, `label`, and `value` identify or annotate parts;
they do not add pins. Optional drawing fields are not electrical models.

| Component / JSON type | Required properties | Optional properties | Pins and positions | Connection and support notes |
| --- | --- | --- | --- | --- |
| Resistor / `resistor` | `from`, `to` | `id`, `label`, `value`, `style`, `labelPos`, `labelNudge`, `labelAt`, `labelAnchor` | 2: `1` at `from`, `2` at `to`; minimum endpoint distance 50 px | Rendered and structurally validated. `style: "zigzag"` changes appearance only. Limited endpoint snapping and eligible rail-tail trimming. |
| Capacitor / `capacitor` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `1` at `from`, `2` at `to`; minimum 12 px | Rendered and structurally validated; no electrical simulation. Limited endpoint snapping and eligible rail-tail trimming. |
| Electrolytic / `electrolytic` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `+` at `from`, `-` at `to`; minimum 12 px | Endpoint order carries polarity. No electrical simulation. |
| Inductor / `inductor` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `1` at `from`, `2` at `to`; minimum 64 px | Rendered and structurally validated; no electrical simulation. |
| Diode / `diode` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `A` at `from`, `K` at `to`; minimum 20 px | Endpoint order carries polarity. |
| Zener diode / `zener` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `A` at `from`, `K` at `to`; minimum 20 px | Endpoint order carries polarity. |
| LED / `led` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `A` at `from`, `K` at `to`; minimum 20 px | Endpoint order carries polarity. |
| Battery / `battery` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `+` at `from`, `-` at `to`; minimum 10 px | Endpoint order carries polarity. |
| Switch / `switch` | `from`, `to` | `id`, `label`, `value`, `closed`, label fields | 2: `1` at `from`, `2` at `to`; minimum 36 px | `closed` changes the drawn blade; it is not a controller pin. |
| Microphone / `mic` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `1` at `from`, `2` at `to`; minimum 36 px | Symbol only; no microphone model. |
| Speaker / `speaker` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `1` at `from`, `2` at `to`; minimum 24 px | `at` is not accepted for this symbol. |
| Lamp / `lamp` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `1` at `from`, `2` at `to`; minimum 28 px | Symbol only; no load model. |
| AC source / `acsource` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `1` at `from`, `2` at `to`; minimum 32 px | Symbol only; no source waveform model. |
| Crystal / `crystal` | `from`, `to` | `id`, `label`, `value`, label fields | 2: `1` at `from`, `2` at `to`; minimum 18 px | Symbol only; no resonator model. |
| NPN transistor / `npn` | `at` | `id`, `label`, `value`, `flip`, `circle`, label fields | 3: `B=(x−25,y)`, `C=(x+25,y−44)`, `E=(x+25,y+44)`; `flip:true` mirrors x offsets | Wire ends must land on calculated coordinates. No general transistor simulation. |
| PNP transistor / `pnp` | `at` | `id`, `label`, `value`, `flip`, `circle`, label fields | 3: `B=(x−25,y)`, `E=(x+25,y−44)`, `C=(x+25,y+44)`; `flip:true` mirrors x offsets | Wire ends must land on calculated coordinates. No general transistor simulation. |
| Op-amp / `opamp` | `at` | `id`, `label`, `value`, `swap`, label fields | 3: `INV=(x−40,y−20)`, `NONINV=(x−40,y+20)`, `OUT=(x+40,y)`; `swap:true` exchanges input y offsets | Generic symbol only; no IC supply pins or amplifier simulation. It is not a model of a specific IC such as an LM358. |
| Ground / `ground` | `at` | `id`, `label`, `value`, label fields | 1 at `at` | Connect a wire endpoint or segment exactly to the pin. |
| Antenna / `antenna` | `at` | `id`, `label`, `value`, `height`, label fields | 1 at `at`; `height` changes the mast drawing, not the pin | Connect a wire endpoint or segment exactly to the pin. |
| Terminal / `terminal` | `at` | `id`, `label`, `value`, label fields | 1 at `at` | Connect a wire endpoint or segment exactly to the pin. |
| Wire / `wire` | `points` (at least 2 coordinate pairs) | `id`, `label`, `open` | Not a component; wire nodes are the route coordinates | Use horizontal/vertical segments and exact endpoints. Crossings alone do not connect; add a `junction` at an intended crossing. `open:true` explicitly permits an intentional open end. |
| Junction / `junction` | `x`, `y` | `id`, `label` | 1 at `(x,y)` | Place exactly on a crossing or wire endpoint that should connect. |
| Text label / `label` | `at`, `text` | `id`, `anchor`, `size`, `bold`, `muted` | 0 electrical pins | Annotation only; does not join nets. |
| Box / `box` | `x`, `y`, `w`, `h` | `id`, `label`, `value` | 0 electrical pins | Drawing annotation only; does not join nets. |

## Validation and auto-fix boundaries

- The shared component catalog, `CircuitGeometry.getCircuitPins`, and the
  CircuitDraw renderer are the source of supported types and pin positions.
- `kicad` elements use an exact `symbolId` and the server-imported
  `symbolData`. See [the KiCad symbol library guide](kicad-symbol-library.md)
  for source, licensing, hydration, and renderer behavior.
- Exact wire endpoints and component overlaps are structurally validated.
  Unconnected component pins are reported as warnings; disconnected wire ends
  and wires passing through a two-terminal symbol are blocking errors.
- Auto-fix only snaps a wire endpoint when exactly one pin is within 8 px. It
  can also trim a narrow class of dangling power/ground rail tails. It does not
  invent components, infer missing pins, or reroute arbitrary wires.
- Conservative electrical sanity checks compare intended pin-to-net groups
  and flag selected cases such as shorted two-terminal parts, shorted BJT
  pins, a BJT base hard-wired to a rail, a likely missing LED series resistor,
  and missing ground. Specialized topology checks also cover known
  two-transistor astable circuits. These heuristics do not model arbitrary
  components, component values, circuit operation, or safety. A rendered
  schematic is not evidence that a circuit is electrically correct or safe.

Unsupported types must be reported rather than silently substituted or assigned
imaginary pins. In particular, generic `ic`, `potentiometer`, and `mosfet`
parts use only the explicit drawing schemas listed above; they do not inherit
manufacturer-specific pinouts or electrical behavior.
