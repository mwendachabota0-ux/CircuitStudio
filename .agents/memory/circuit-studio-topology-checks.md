---
name: Circuit Studio topology checks
description: Circuit Studio's expected validation and repair behavior for generated schematics.
---

Circuit Studio should identify known circuit topology faults, use exact validator findings to request repairs, and avoid regenerating the same invalid wiring. Repairs to an existing draft must preserve its components and stage a checked proposal rather than silently replacing the user's work.

**Why:** The user asked the app to identify the alternating-flasher wiring faults, fix them, and not repeat those errors.

**How to apply:** Add deterministic tests for known circuit patterns, enforce them before proposals can be applied, and pass the findings to automatic repair attempts. Keep structural checking distinct from electrical simulation and safety review.
