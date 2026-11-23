---
name: Circuit Studio builder intent
description: How Circuit Studio should infer whether a conversation calls for a schematic proposal.
---

New conversations start in Chat. A session's selected mode remains active across messages and AI responses; only an explicit user action changes it. Clearing or starting a new conversation resets to Chat, while restoring a history session restores its saved mode. Typed build requests and affirmative replies stay in Chat and leave work on standby; clicking Build starts the standby work, if any.

Unfinished Chat-mode conversations are valid history sessions even when no circuit has been built. Save them as the user chats, and restore their messages and Chat mode so the user can resume clarifying and choose Build later.

**Why:** The user requires Chat as the default for new conversations and explicitly asked that Build mode not switch back to Chat unless they choose to, clear the conversation, or start a new one.

**How to apply:** Never switch modes in response to an AI result. Restore the saved mode for an existing history session, and keep typed build requests on standby until the user selects Build.
