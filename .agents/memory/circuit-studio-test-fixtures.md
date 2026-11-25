---
name: Circuit Studio test fixtures
description: Fixture design rules for strict pin validation and saved coordinate-based circuits.
---

Test CircuitSpecs must match the pin policy being exercised: supported discrete and KiCad pins are required unless the source explicitly marks a pin no-connect. Geometry-only tests can connect test pins to terminals at their exact coordinates.

Backward-compatibility tests should use a valid coordinate-based CircuitSpec without topology, rather than a known-invalid proposal. Test rendering and validation against the same legacy fixture when both are part of the compatibility claim.

**Why:** Strict pin-aware validation rejects unconnected standard-part fixtures even when a test is intended to cover symbol geometry, and intentionally invalid examples are not evidence that valid saved circuits remain compatible.

**How to apply:** When a fixture fails after validation changes, check whether it violates the active contract before weakening production validation. Update the fixture to preserve its test intent while representing valid data.
