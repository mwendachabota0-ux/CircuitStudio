---
name: Schematic view controls
description: User-approved behavior for the Circuit Studio schematic Fit and fullscreen controls.
---

Circuit Studio keeps Fit-to-view and fullscreen as separate actions. Fit resets the schematic to its fitted view; fullscreen expands the drawing to the window and has its own exit control. Do not make Fit cycle between zoom reset and fullscreen.

**Why:** The user explicitly approved the separate buttons and rejected a proposed cycling behavior.

**How to apply:** Preserve a dedicated Fit-to-view button and a separate fullscreen enter/exit button when changing schematic controls.
