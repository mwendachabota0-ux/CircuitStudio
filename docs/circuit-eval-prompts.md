# CircuitStudio AI circuit-evaluation prompts

Use each prompt as written in Build mode and inspect both the returned
`proposal.intent` and the rendered pin-to-net connectivity. In the expected
groups below, pins separated by commas belong to one net, and semicolons
separate nets. Unlisted external terminals are deliberately omitted because
they are not component pins in the derived netlist.

The designators shown in expected groups are the fixture's expected reference
designators. If the builder assigns different labels, map the groups to the
corresponding parts by role before comparing.

These examples check intent interpretation and a drawing's connectivity, not
simulation or electrical safety. Do not compare net names or wire geometry;
compare pin groups. A missing `intent` is a review failure for valid proposal
fixtures. Prompt 20 is expected to return a clarification or compatibility
message without a proposal. The evaluation should also confirm that a blocking
finding prevents applying the proposal, while warnings remain advisory unless
a separate layout repair is requested.

| # | Prompt | Expected pin-net groups |
|---:|---|---|
| 1 | Draw a battery-powered LED indicator with a switch and a series current-limiting resistor. | `B1.+, SW1.1; SW1.2, R1.1; R1.2, D1.A; D1.K, B1.-` |
| 2 | Draw a basic battery, resistor, and red LED in one series loop. | `B1.+, R1.1; R1.2, D1.A; D1.K, B1.-` |
| 3 | Draw two parallel LED branches across a battery, with one resistor in series with each LED. | `B1.+, R1.1, R2.1; R1.2, D1.A; R2.2, D2.A; D1.K, D2.K, B1.-` |
| 4 | Use an NPN transistor as a low-side switch for an LED load; drive its base through a resistor. | `B1.+, R_LOAD.1; R_LOAD.2, D1.A; D1.K, Q1.C; Q1.E, B1.-; R_BASE.2, Q1.B` |
| 5 | Draw an NPN low-side switch with a base-input resistor and a base pull-down resistor. | `B1.+, R_LOAD.1; R_LOAD.2, Q1.C; Q1.E, R_PULLDOWN.2, B1.-; R_INPUT.2, Q1.B, R_PULLDOWN.1` |
| 6 | Make a dark-activated LED night-light using an LDR divider, an NPN switch, and an LED resistor. | `R1.1, R2.1; R1.2, LDR1.1, Q1.B; LDR1.2, Q1.E; R2.2, LED1.A; LED1.K, Q1.C` |
| 7 | Draw a two-transistor astable LED flasher with separate cross-coupled timing capacitors. | `R1.1, R2.1, R3.1, R4.1; Q1.E, Q2.E; R1.2, LED1.A; LED1.K, Q1.C, C1.+; C1.-, Q2.B, R4.2; R3.2, Q1.B, C2.-; R2.2, LED2.A; LED2.K, Q2.C, C2.+` |
| 8 | Draw a two-resistor voltage divider across a battery, with the output at the resistor junction. | `B1.+, R1.1; R1.2, R2.1; R2.2, B1.-` |
| 9 | Add a series protection diode before a resistor-limited LED on a battery supply. | `B1.+, D1.A; D1.K, R1.1; R1.2, LED1.A; LED1.K, B1.-` |
| 10 | Put the switch in the return leg of a battery-powered, resistor-limited LED. | `B1.+, R1.1; R1.2, D1.A; D1.K, SW1.1; SW1.2, B1.-` |
| 11 | Draw a battery rail with an electrolytic bypass capacitor connected across it. | `B1.+, C1.+; B1.-, C1.-` |
| 12 | Draw two resistors in parallel across a battery, sharing both endpoints. | `B1.+, R1.1, R2.1; R1.2, R2.2, B1.-` |
| 13 | Use two switches in parallel to control one battery-powered lamp. | `B1.+, SW1.1, SW2.1; SW1.2, SW2.2, L1.1; L1.2, B1.-` |
| 14 | Use two switches in series to control one battery-powered lamp. | `B1.+, SW1.1; SW1.2, SW2.1; SW2.2, L1.1; L1.2, B1.-` |
| 15 | Draw a PNP high-side transistor switch feeding a resistor-limited LED. | `B1.+, Q1.E; Q1.C, R1.1; R1.2, D1.A; D1.K, B1.-; R_BASE.2, Q1.B` |
| 16 | Draw an NPN common-emitter stage with a collector load, emitter resistor, and a two-resistor base divider. | `B1.+, R_C.1, R1.1; R_C.2, Q1.C; Q1.E, R_E.1; R_E.2, R2.2, B1.-; R1.2, R2.1, Q1.B` |
| 17 | Draw a simple series RC branch across a battery, with the resistor before the capacitor. | `B1.+, R1.1; R1.2, C1.1; C1.2, B1.-` |
| 18 | Build an LED indicator with a resistor and a switch in series; do not bypass either part. | `B1.+, SW1.1; SW1.2, R1.1; R1.2, D1.A; D1.K, B1.-` |
| 19 | Draw a two-LED flasher using two NPN transistors and cross-coupled electrolytic capacitors. | `R1.1, R2.1, R3.1, R4.1; Q1.E, Q2.E; R1.2, LED1.A; LED1.K, Q1.C, C1.+; C1.-, Q2.B, R4.2; R3.2, Q1.B, C2.-; R2.2, LED2.A; LED2.K, Q2.C, C2.+` |
| 20 | Draw a generic MOSFET switch, but no manufacturer, model, or pinout is specified. | No pin groups are accepted until a specific supported symbol and pin model are available; ask for the missing part details rather than inventing pins or silently substituting another component. |

For prompts 1–19, compare only listed connections and ensure unrelated pins
remain separate. Review values, ratings, polarity, and behavior independently.
Prompt 20 is a compatibility negative control: the builder should request a
supported symbol or clearly report the limitation instead of fabricating a
pinout.
