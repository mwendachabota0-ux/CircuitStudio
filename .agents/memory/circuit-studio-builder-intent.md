---
name: Circuit Studio builder intent
description: How Circuit Studio should infer whether a conversation calls for a schematic proposal.
---

Circuit Studio always opens in Chat. Only clicking the Build tab enters Build; typed build requests and affirmative replies stay in Chat and leave work on standby. Clicking Build starts the standby work, if any.

Unfinished Chat-mode conversations are valid history sessions even when no circuit has been built. Save them as the user chats, and restore their messages and Chat mode so the user can resume clarifying and choose Build later.

**Why:** The user explicitly requires Chat as the default and Build mode to be entered only through the Build tab.

**How to apply:** Never switch to Build from text, AI output, restored history, or another action. Keep requests on standby, tell the user to click Build, and start queued work only from that tab click.
