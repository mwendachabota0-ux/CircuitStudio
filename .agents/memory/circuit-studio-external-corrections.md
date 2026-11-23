---
name: External correction workflow
description: How CircuitStudio should handle a complete CircuitSpec corrected outside the app.
---

Treat a pasted corrected CircuitSpec as the user's completed replacement, not as a request for CircuitStudio to repair or regenerate it. Validate and stage that exact candidate, then replace the entire workbench drawing only after the user chooses to apply it. Hydrate missing KiCad geometry from the verified catalog and keep deterministic drawing checks in place.

After the user applies a meaningful correction, save a concise, deduplicated, account-specific lesson from the rejected drawing, accepted replacement, and concrete findings. Use only a compact structured diff and relevant findings for lesson generation. Do not create lessons for invalid, unapplied, or non-informative changes, and never describe drawing checks or lessons as proof of electrical correctness or safety.

**Why:** The user clarified that external corrections are already fixed code to install as a replacement; AI repair is unnecessary, while learning from applied corrections remains useful.

**How to apply:** Keep paste handling local and deterministic, preserve the rejected version for comparison until apply, and trigger lesson creation only after the replacement is applied.
