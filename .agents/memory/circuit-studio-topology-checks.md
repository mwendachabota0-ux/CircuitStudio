---
name: Circuit Studio topology checks
description: Circuit Studio's expected validation and repair behavior for generated schematics.
---

Circuit Studio should identify known circuit topology faults, use exact validator findings to request repairs, and avoid regenerating the same invalid wiring. Repairs to an existing draft must preserve its components and stage a checked proposal rather than silently replacing the user's work. Since the model can return a redesigned full spec despite wiring-only instructions, restore the original non-wire elements and canvas metadata onto each repair response before validating it; use the normalized spec as the next retry's starting point and retain that same baseline for manual retries.

**Why:** The user asked the app to identify the alternating-flasher wiring faults, fix them, and not repeat those errors. A reject-only guard prevented component changes from applying but did not help the model correct its wiring; deterministic restoration keeps the user's parts while allowing the new wires to be validated and retried.

**How to apply:** Add deterministic tests for known circuit patterns, enforce them before proposals can be applied, and pass the findings to automatic repair attempts. For existing-draft repairs, merge model-produced wires with the exact original non-wire elements before validation. Keep structural checking distinct from electrical simulation and safety review.
