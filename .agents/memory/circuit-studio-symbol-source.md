---
name: Circuit Studio symbol source
description: Circuit Studio's default component-symbol source when drawing circuits.
---

For circuit drawing, prefer the official KiCad symbol library by default. Use exact catalog IDs and verified pin definitions; use built-in approximations only when no supplied KiCad candidate fits or the user requests a generic abstraction.

In the component library, show 100 common KiCad symbols on a dedicated Page 0, then show the full catalog in 100-symbol pages. Repeated common symbols on later catalog pages are intentional.

Studio AI should search across the full KiCad catalog during both Chat planning and Build, and use catalog descriptions to inform component choices even before a schematic is requested.

**Why:** The user explicitly wants Studio AI to consult the available library symbols while deciding what circuit to draw, not only when generating the schematic.

**How to apply:** Keep the KiCad catalog selected by default and provide relevant full-catalog matches to Chat. In Build, supply exact pin definitions before the model can place catalog symbols. Preserve the featured Page 0 and 100-result full-catalog pages. Do not invent IDs, pinouts, physical part choices, or safety claims.
