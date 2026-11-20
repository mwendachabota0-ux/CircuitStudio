---
name: Circuit topology checks
description: Structural validation rules and limits for generated circuit proposals.
---

Generated proposals must not be applyable with disconnected required pins, diagonal wire segments, or zero-length wire segments. Treat two-terminal and supported discrete-component pins as required. A relay requires both coil pins, COM, and at least one of NC/NO; the unused contact is advisory. Unused IC, connector, and KiCad pins remain advisory because they may be intentional.

Repairs should change wires only and preserve component identities, values, orientations, and positions. Structural checks confirm drawing connectivity and geometry only; they do not prove electrical operation, ratings, mains safety, compliance, or certification.

**Why:** A proposal can render while still having floating supply/control pins or unreadable routes, and the app has no general circuit simulator.

**How to apply:** Keep the generation prompt, validator, repair path, and Apply gate aligned. Add component-specific topology checks when justified, preserve legitimate no-connect cases, and never present structural validation as proof that a circuit works or is safe.
