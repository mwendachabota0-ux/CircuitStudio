export type NumberedAiKey = { number: number };

export function canFallbackToAnotherKey(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = Number(record.status);
  if (status === 429 || status === 503) return true;
  const code = `${record.code ?? ""} ${record.message ?? ""}`.toLowerCase();
  return /quota|rate.?limit|resource.?exhausted/.test(code);
}

export function orderKeysAfter<T extends NumberedAiKey>(
  keys: readonly T[],
  usedKeyNumber: number,
): T[] {
  const ordered = [...keys].sort((left, right) => left.number - right.number);
  if (ordered.length < 2) return ordered;

  const usedIndex = ordered.findIndex((key) => key.number === usedKeyNumber);
  const nextIndex = usedIndex >= 0
    ? (usedIndex + 1) % ordered.length
    : ordered.findIndex((key) => key.number > usedKeyNumber);
  const startIndex = nextIndex >= 0 ? nextIndex : 0;

  return [...ordered.slice(startIndex), ...ordered.slice(0, startIndex)];
}
