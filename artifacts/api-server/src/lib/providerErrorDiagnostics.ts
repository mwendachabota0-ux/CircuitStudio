export type ProviderErrorDiagnostics = {
  providerKeyNumber: number;
  providerStatus?: number;
  providerCode?: string;
  providerErrorType?: string;
  failurePhase?: string;
};

const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,47}$/;

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value)
    ? value
    : undefined;
}

export function getProviderErrorDiagnostics(
  error: unknown,
  providerKeyNumber: number,
): ProviderErrorDiagnostics {
  const diagnostics: ProviderErrorDiagnostics = { providerKeyNumber };
  if (typeof error !== "object" || error === null) return diagnostics;

  const record = error as Record<string, unknown>;
  const status = Number(record.status);
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    diagnostics.providerStatus = status;
  }

  const code = safeIdentifier(record.code);
  if (code) diagnostics.providerCode = code;

  const errorType = safeIdentifier(record.name);
  if (errorType) diagnostics.providerErrorType = errorType;

  return diagnostics;
}

export function getSafeErrorType(error: unknown): string {
  if (typeof error !== "object" || error === null) return "UnknownError";
  return safeIdentifier((error as Record<string, unknown>).name) ?? "UnknownError";
}
