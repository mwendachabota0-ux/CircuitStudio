---
name: Circuit Studio builder intent
description: How Circuit Studio should infer whether a conversation calls for a schematic proposal.
---

Circuit Studio should infer Chat versus Build from the user's meaning and conversation context, not require particular command words. The current tab is a default, not a constraint. Use Chat for explanations, exploration, hypotheticals, and unclear requests; use Build when the user clearly wants a concrete circuit outcome or edit, even when phrased indirectly.

**Why:** The user asked the assistant to recognize when a request calls for Build mode without relying on specific words.

**How to apply:** Keep deterministic client shortcuts limited to explicit mode-switch commands. Let the AI classify ordinary messages, and do not force the selected tab's mode over the model's decision.
