# Circuit patterns and pin-net intent

These are schematic topology patterns, not validated designs. Use the exact
pin names below when recording intent. Each semicolon-separated group is one
net; pins in different groups must remain separate. Values, polarity,
component ratings, transistor bias, and physical safety require independent
engineering review. Structural and electrical sanity checks do not simulate
or certify a circuit.

## 1. Series LED indicator

**Use:** A battery, switch, current-limiting resistor, and LED in one series
path.

**Intended nets**

```text
B1.+, SW1.1
SW1.2, R1.1
R1.2, D1.A
D1.K, B1.-
```

Keep the resistor in series with the LED; do not connect the LED directly
across the source. The drawing checker can flag a likely missing resistor, but
does not calculate a suitable value or verify the source voltage.

## 2. NPN low-side switch

**Use:** An NPN transistor switches a low-side load. The base is driven through
a resistor, and the emitter returns to source negative.

**Intended nets**

```text
B1.+, R_LOAD.1
R_LOAD.2, Q1.C
Q1.E, B1.-
R_BASE.2, Q1.B
```

`R_BASE.1` is the control-input side and is intentionally not grouped with
the transistor. Add an appropriate base pull-down when the control source can
float. This pattern does not establish transistor ratings, gain, or load
compatibility.

## 3. Dark-activated LED using a photoresistor

**Use:** A photoresistor and fixed resistor form a divider that controls an
NPN low-side switch; a separate resistor limits LED current. This follows the
included dark-activated LED reference fixture.

**Intended nets**

```text
R1.1, R2.1
R1.2, LDR1.1, Q1.B
LDR1.2, Q1.E
R2.2, LED1.A
LED1.K, Q1.C
```

The supply and ground symbols label the rails but are not listed as component
pins. The checker verifies only the drawing's pin groups and selected generic
rules; it does not model light-dependent resistance or switching thresholds.

## 4. Two-transistor astable LED flasher

**Use:** A cross-coupled NPN astable with two collector loads, two base-bias
resistors, and two electrolytic timing capacitors.

**Intended nets**

```text
R1.1, R2.1, R3.1, R4.1
Q1.E, Q2.E
R1.2, LED1.A
LED1.K, Q1.C, C1.+
C1.-, Q2.B, R4.2
R3.2, Q1.B, C2.-
R2.2, LED2.A
LED2.K, Q2.C, C2.+
```

Do not merge the two base nets. Capacitor polarity and transistor pin
orientation are significant. The topology check is a narrow pattern check,
not a timing, oscillation, or component-rating simulation.

## 5. Two parallel LED branches

**Use:** Two individually current-limited LED branches share supply and return
rails.

**Intended nets**

```text
B1.+, R1.1, R2.1
R1.2, D1.A
R2.2, D2.A
D1.K, D2.K, B1.-
```

Keep each resistor in series with its own LED. A shared resistor or a direct
LED-to-rail connection is a different topology and should be stated explicitly.
