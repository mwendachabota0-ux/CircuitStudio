# Circuit regression fixtures

These small `CircuitSpec` examples exercise software checks and renderer compatibility only. They are not electrical simulations, proof of operation, or safety certification.

See [the AI circuit-evaluation prompts](../../../../../docs/circuit-eval-prompts.md)
for expected intent nets and [the documented patterns](../../../../../docs/circuit-patterns.md)
for reference topologies.

| Fixture | Purpose | Expected connectivity or behavior |
|---|---|---|
| `series-led.json` | Structural validity for a series source, switch, resistor, LED, and return path. | B1.+ → SW1.1; SW1.2 → R1.1; R1.2 → D1.A; D1.K → B1.-. |
| `single-transistor-switch.json` | Structural validity for one NPN load switch, a base input resistor, and a base pull-down. | R_INPUT.2, Q1.B, and R_PULLDOWN.1 share the control node; the pull-down and emitter return to source negative. |
| `parallel-led-branches.json` | Parallel branches, shared supply/return, and explicit multi-terminal junctions. | B1.+, R1.1, and R2.1 share one net; B1.-, D1.K, and D2.K share another. |
| `shared-base-switches.json` | Negative control for astable-only validation. Two transistor bases intentionally share a control net. | Q1.B and Q2.B share a net; no astable-specific finding is expected. |
| `astable-flasher.json` | Existing two-transistor astable sample; its two dangling rail tails are removed by safe deterministic cleanup before the structural check. | Q1.B and Q2.B remain separate, with collector-to-opposite-base capacitors. |
| `dark-activated-led.json` | Dark-activated LED using a photoresistor divider, NPN switch, and LED current-limiting resistor. | The intended pin groups match the geometry-derived netlist; generic electrical checks report no errors or warnings. |
| `failed-flasher-bases-shorted.json` | Reference flasher with each base accidentally connected to its emitter/ground through crossing wire geometry. | Q1.B/Q1.E and Q2.B/Q2.E are each on one GND net; BJT short findings remain independent of the title. |
| `circuit-compatibility-samples.json` | Bundled legacy renderer/schema examples for KiCad, amplifier, converter, transmitter, and LED-chaser circuits. | Compatibility coverage only; the bundle does not assert that each example is electrically valid. |
| Derived base-short variant in `circuit-regression-fixtures.test.mjs` | Astable topology validation, including title-independence. | A wire tying Q1.B to Q2.B produces the same blocking finding with the original and neutral titles. |
| `non-connecting-crossing.json` | Non-connecting crossing annotation with no junction. | Both wire strokes remain continuous; horizontal battery positives stay on one net and vertical battery positives on another. |
| `parallel-led-branches.json` | Three-terminal supply branch through an explicit junction. | The positive supply joins the source and both branch resistors. |
| `legacy-fm-transmitter-dcsource.json` | Legacy FM-transmitter-style renderer and supported `dcsource` compatibility. | V1 remains a DC voltage source; source return and ground share a net. |
| `fm-transmitter-compatible.json` | Existing FM transmitter compatibility sample using a labeled supply terminal. | Existing structural compatibility and rendering behavior remain covered. |

KiCad symbol rendering, pin placement, fractional rotations, and missing source-data rejection remain covered by the renderer tests in `circuit-draw-validation.test.mjs`; no separate KiCad fixture file was present.
