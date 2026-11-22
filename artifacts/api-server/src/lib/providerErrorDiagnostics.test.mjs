import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderErrorDiagnostics,
  getSafeErrorType,
} from "./providerErrorDiagnostics.ts";

test("logs safe provider metadata without error messages or credentials", () => {
  const error = Object.assign(
    new Error("request failed for prompt text with key=do-not-log"),
    { status: 502, code: "BAD_GATEWAY" },
  );
  const diagnostics = getProviderErrorDiagnostics(error, 4);

  assert.deepEqual(diagnostics, {
    providerKeyNumber: 4,
    providerStatus: 502,
    providerCode: "BAD_GATEWAY",
    providerErrorType: "Error",
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /do-not-log|prompt text/);
});

test("omits unsafe provider identifiers and reports unknown error types safely", () => {
  const error = {
    status: 200,
    code: "api-key=secret",
    name: "provider error with private details",
  };

  assert.deepEqual(getProviderErrorDiagnostics(error, 1), {
    providerKeyNumber: 1,
  });
  assert.equal(getSafeErrorType(error), "UnknownError");
});
