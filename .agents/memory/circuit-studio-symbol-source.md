---
name: Circuit Studio symbol source
description: Circuit Studio's default component-symbol source when drawing circuits.
---

For circuit drawing, prefer the official KiCad symbol library by default. Use exact catalog IDs and verified pin definitions; use built-in approximations only when no supplied KiCad candidate fits or the user requests a generic abstraction.

In the component library, show 100 common KiCad symbols on a dedicated Page 0, then show the full catalog in 100-symbol pages. Repeated common symbols on later catalog pages are intentional.

**Why:** The user prefers KiCad's broader, familiar coverage and explicitly chose this browsing pattern and page size.

**How to apply:** Keep the KiCad catalog selected by default and provide matching, verified KiCad candidates to Build-mode generation. Preserve the featured Page 0 and 100-result full-catalog pages. Do not invent IDs, pinouts, physical part choices, or safety claims.
