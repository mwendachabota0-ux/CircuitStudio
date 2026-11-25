---
name: Native Node test imports
description: Runtime import constraints for tests using Node's built-in TypeScript stripping.
---

When `.mjs` tests run with `node --experimental-strip-types`, imports that pass through a TypeScript barrel with extensionless relative re-exports can fail with `ERR_MODULE_NOT_FOUND`. For runtime-generated Zod schemas, import the generated `.ts` module directly instead of the package barrel.

**Why:** Node's native TypeScript stripping does not provide the extension resolution behavior used by the workspace's bundler-based TypeScript configuration.

**How to apply:** Keep test imports explicit and `.ts`-suffixed; do not change generated code just to accommodate the test runner.
