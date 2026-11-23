---
name: Circuit Studio cancellation scope
description: Keep stopping a proposal review independent from stopping chat or circuit generation.
---

Provide separate controls for stopping the advisory review and stopping the active chat/build request. Stopping a review may also stop a layout repair that the review itself started, but must not cancel an unrelated builder request; stopping builder work must not cancel a separate review.

**Why:** The user explicitly asked for separate ways to cancel review and to stop thinking, working, or drawing, rather than one control that stops everything.

**How to apply:** Keep review and builder requests on distinct abort controllers; scope review-triggered layout work to that review and leave unrelated active processes alone.
