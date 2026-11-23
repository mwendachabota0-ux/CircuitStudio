---
name: External correction workflow
description: How CircuitStudio should handle a complete CircuitSpec corrected outside the app.
---

Treat a pasted corrected CircuitSpec as the user's completed replacement, not as a request for CircuitStudio to repair or regenerate it. Check a pasted correction automatically and compare it with the rejected draft; learning does not wait for the user to apply the staged replacement. Direct edits to the editable CircuitSpec should also be compared with the previous valid draft after a short pause.

Store account-specific guidance privately, and share only a generalized, non-identifying drawing lesson across all users. Never put raw CircuitSpecs, titles, values, prompts, or account identifiers in the shared store. Keep exact pasted corrections unchanged and allow the user to apply them separately after checks pass.

**Why:** The user explicitly requires pasting an external correction or editing the CircuitSpec to be enough to teach the app, with reusable knowledge shared across all users.

**How to apply:** Compare before/after specs plus drawing-check findings, save only reusable generalized advice, and inject relevant shared lessons into future Build requests as advisory context. Never run AI repair or review on a complete externally corrected replacement.
