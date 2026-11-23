---
name: Circuit topology checks
description: Structural validation rules and limits for generated circuit proposals.
---

Generated proposals must not be applyable with disconnected required pins, diagonal wire segments, zero-length wire segments, or wires that cross component symbol bodies. Wire routes may meet a symbol at its actual connection pins but must go around its body. Treat two-terminal and supported discrete-component pins as required. A relay requires both coil pins, COM, and at least one of NC/NO; the unused contact is advisory. Unused IC, connector, and KiCad pins remain advisory because they may be intentional.

After repair attempts fail, a structurally invalid but renderable proposal may be shown in a read-only preview with a small “Needs repair” label. Never offer Apply for that preview. Repairs should change wires only and preserve component identities, values, orientations, and positions. Structural checks confirm drawing connectivity and geometry only; they do not prove electrical operation, ratings, mains safety, compliance, or certification.

**Why:** A proposal can render while still having floating supply/control pins, unreadable routes, or wires drawn through components. The user reported that the drawing AI often routes wires through parts such as resistors and wants those routed around the symbol body. The app has no general circuit simulator.

**How to apply:** Keep the generation prompt, body-crossing layout check, repair path, and Apply gate aligned so AI proposals are rerouted before they can be applied. Add component-specific topology checks when justified, preserve legitimate no-connect cases, and never present structural validation as proof that a circuit works or is safe.
