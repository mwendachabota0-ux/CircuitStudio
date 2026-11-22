---
name: Circuit Studio input focus
description: Evidence and recovery steps for text fields that lose focus.
---

When the user reported that text inputs immediately lost focus, captured `/api/ai/status` and `/api/ai/usage` calls were returning HTTP 200. No disabled or read-only state was found on the textareas inspected. A Vite connection loss/reconnect appeared in the browser log during the workflow restart performed for the fix, so it is not evidence of the original cause. The user later confirmed the issue was fixed after the composer was given a stable React key, a positioned stacking layer, and explicit pointer interaction.

The exact cause across every input was not proven: the signed-in workbench could not be reproduced in the screenshot browser, and the saved logs do not include focus or pointer events. The change and restart were made together, so the logs cannot tell which part restored typing. Treat this as a confirmed recovery, not proof of a specific global CSS or backend root cause.

**Why:** Broad focus loss can look like a backend failure, but the captured API requests succeeded; the available evidence cannot isolate a single trigger.

**How to apply:** If it happens again, inspect fresh browser-console and API logs first. Check for HMR disconnects or reloads, then inspect overlays, `pointer-events`, and `disabled`/`readOnly` on the affected page's inputs. Restart the web workflow only if the dev client is stale; do not assume the database or AI provider is responsible without failing requests in the logs.
