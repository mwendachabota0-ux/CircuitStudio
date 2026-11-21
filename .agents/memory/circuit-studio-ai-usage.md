---
name: Circuit Studio AI usage policy
description: Circuit Studio tracks AI usage but does not impose its own token cap.
---

Circuit Studio must not block AI requests based on cumulative token usage. Keep per-account usage tracking for visibility and reservations, while making clear that Gemini's own quotas and provider costs still apply.

**Why:** The user chose to remove the app-side lifetime cap after being told this increases provider usage and cost exposure.

**How to apply:** Do not add a lifetime or monthly app-side token limit unless the user changes this policy. Keep the usage display accurate and preserve provider key failover.

When circuit generation stops at the model's output limit, pass the partial response to the next configured key and have it complete the response using a lower thinking budget. Record usage for each call and keep CircuitDraw validation in force.

**Why:** The user wants one AI key to hand off unfinished work to the next key so generation can continue from what was already produced.

**How to apply:** Use the next configured key after the key that actually returned the partial response. Do not discard partial output or accept a proposal that has not passed the existing validation flow.
