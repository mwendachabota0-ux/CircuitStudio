---
name: Circuit Studio topology checks
description: Circuit Studio's expected validation and repair behavior for generated schematics.
---

Circuit Studio should identify known circuit topology faults, use exact validator findings to request repairs, and avoid regenerating the same invalid wiring. Repairs to an existing draft must preserve its components and stage a checked proposal rather than silently replacing the user's work. Since the model can return a redesigned full spec despite wiring-only instructions, restore the original non-wire elements and canvas metadata onto each repair response before validating it; use the normalized spec as the next retry's starting point and retain that same baseline for manual retries.

When an automatic repair fails but a rejected proposal exists, manual Retry must continue from that proposal and include its blocking findings instead of restarting the original build. Keep the rejected preview visible until a new repair succeeds. Before sending any retry, trim oversized history messages to the API's per-message limit while preserving their beginning and end.

Only blocking structural/topology faults should prevent a proposal from being staged or consume repair retries. Disconnected wire ends and wires shorting components are errors; diagonal routing, tight visual spacing, and other advisory layout notes remain warnings. For known astable circuits, validate critical base feedback and emitter return paths so making generic pin warnings non-blocking does not hide those faults.

**Why:** The user asked the app to identify the alternating-flasher wiring faults, fix them, and not repeat those errors, while accepting correct circuits. They also explicitly asked manual Retry to fix issues from unfinished work rather than erase progress and redo the full request. Treating every warning as a failure rejected valid but visually nonstandard designs. A reject-only guard also prevented component changes from applying without helping the model correct its wiring.

**How to apply:** Add deterministic tests for known circuit patterns, classify electrical/topology blockers separately from visual notes, and pass only blockers to automatic repair attempts. For existing-draft repairs, merge model-produced wires with the exact original non-wire elements before validation. For manual continuation, retain the rejected spec, latest findings, and original protection baseline. Keep structural checking distinct from electrical simulation and safety review.
