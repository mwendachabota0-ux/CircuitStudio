---
name: Circuit Studio access
description: The user's access rule and authentication choice for Circuit Studio.
---

Circuit Studio uses Replit-managed Clerk with open sign-up. The public introduction remains accessible without an account; the workbench and Gemini generation require sign-in.

**Why:** The user chose open sign-up for a public app while still requiring an account before anyone can use the Gemini-backed workbench.

**How to apply:** Keep account creation open, preserve the public landing page, and enforce authentication in both the workbench route and the circuit-generation API.
