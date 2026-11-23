import type { CircuitSpec } from '@workspace/api-client-react';

export type CircuitSpecJsonParseResult =
  | { ok: true; spec: CircuitSpec }
  | { ok: false; error: string };

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value) ?? 'undefined';
}

export function areCircuitSpecsEqual(left: CircuitSpec, right: CircuitSpec): boolean {
  return stableStringify(left) === stableStringify(right);
}

export function parseCircuitSpecJson(value: string): CircuitSpecJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, error: 'JSON is incomplete or malformed. Studio AI can try to interpret it.' };
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof (parsed as { title?: unknown }).title !== 'string' ||
    !Array.isArray((parsed as { elements?: unknown }).elements)
  ) {
    return { ok: false, error: 'Expected a CircuitSpec with a string title and an elements array.' };
  }

  const candidate = parsed as { width?: unknown; height?: unknown; elements: unknown[] };
  if (
    (candidate.width !== undefined && typeof candidate.width !== 'number') ||
    (candidate.height !== undefined && typeof candidate.height !== 'number')
  ) {
    return { ok: false, error: 'Optional width and height values must be numbers.' };
  }

  const invalidElementIndex = candidate.elements.findIndex(
    (element) =>
      !element ||
      typeof element !== 'object' ||
      Array.isArray(element) ||
      typeof (element as { type?: unknown }).type !== 'string',
  );
  if (invalidElementIndex >= 0) {
    return {
      ok: false,
      error: `Element ${invalidElementIndex + 1} must be an object with a string type.`,
    };
  }

  return { ok: true, spec: parsed as CircuitSpec };
}
