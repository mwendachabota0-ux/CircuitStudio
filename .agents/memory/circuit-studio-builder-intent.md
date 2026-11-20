---
name: Circuit Studio builder intent
description: How Circuit Studio should infer whether a conversation calls for a schematic proposal.
---

Inferred circuit intent must not switch Circuit Studio from Chat to Build. Ask permission before preparing a schematic. A direct build/draw/create request, manually selecting Build, or explicitly accepting the permission question counts as approval; vague goals and positive reactions do not.

**Why:** The user wants to approve inferred build actions rather than have the assistant change modes on its own.

**How to apply:** Keep inferred requests in Chat and show a clear yes/no permission prompt when a schematic is ready. Allow direct build commands and manual Build selection to proceed; treat an explicit decline as a reason to remain in Chat.
