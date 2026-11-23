import type {
  CircuitDesignBrief,
  CircuitSpec,
} from '@workspace/api-client-react';

export type ExternalCircuitFixContext = {
  rejectedSpec: CircuitSpec;
  reportedProblems: string[];
  advisoryWarnings: string[];
  originalRequest: string;
  designBrief: CircuitDesignBrief;
};

export type ExternalCircuitFixDiff = {
  hasChanges: boolean;
  changeCount: number;
  summary: string;
  details: string[];
};

export type ExternalCircuitFixProposal = {
  spec: CircuitSpec;
  diff: ExternalCircuitFixDiff;
  summary: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'symbolData')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableValue(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function elementLabel(element: Record<string, unknown>): string {
  const type = typeof element.type === 'string' ? element.type : 'element';
  const id = typeof element.id === 'string' ? ` ${element.id}` : '';
  return `${type}${id}`;
}

export function parseExternalCircuitFixSpec(value: string): CircuitSpec {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const json = fenced?.[1]?.trim() ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Paste the complete CircuitSpec as JSON, with no extra text.');
  }

  const record = asRecord(parsed);
  if (typeof record.title !== 'string' || !Array.isArray(record.elements)) {
    throw new Error('The pasted JSON needs a CircuitSpec title and elements array.');
  }
  return record as CircuitSpec;
}

export function summarizeExternalCircuitFix(
  before: CircuitSpec,
  after: CircuitSpec,
): ExternalCircuitFixDiff {
  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);
  const beforeElements = Array.isArray(beforeRecord.elements)
    ? beforeRecord.elements.map(asRecord)
    : [];
  const afterElements = Array.isArray(afterRecord.elements)
    ? afterRecord.elements.map(asRecord)
    : [];
  const beforeById = new Map(beforeElements.map((element, index) => [
    typeof element.id === 'string' ? element.id : `#${index}`,
    element,
  ]));
  const afterById = new Map(afterElements.map((element, index) => [
    typeof element.id === 'string' ? element.id : `#${index}`,
    element,
  ]));
  const additions: string[] = [];
  const removals: string[] = [];
  const updatedWires: string[] = [];
  const updatedComponents: string[] = [];

  for (const [id, oldElement] of beforeById) {
    const nextElement = afterById.get(id);
    if (!nextElement) {
      removals.push(`Removed ${elementLabel(oldElement)}`);
      continue;
    }
    const fields = new Set([...Object.keys(oldElement), ...Object.keys(nextElement)]);
    const changedFields = [...fields].filter((field) =>
      field !== 'symbolData' &&
      stableValue(oldElement[field]) !== stableValue(nextElement[field]),
    );
    if (!changedFields.length) continue;
    const label = `${elementLabel(nextElement)} (${changedFields.slice(0, 3).join(', ')})`;
    if (nextElement.type === 'wire' || oldElement.type === 'wire') {
      updatedWires.push(`Updated ${label}`);
    } else {
      updatedComponents.push(`Updated ${label}`);
    }
  }

  for (const [id, element] of afterById) {
    if (!beforeById.has(id)) additions.push(`Added ${elementLabel(element)}`);
  }

  const changedSettings = new Set([
    ...Object.keys(beforeRecord),
    ...Object.keys(afterRecord),
  ]);
  const metadataChanges = [...changedSettings].filter((field) =>
    field !== 'elements' &&
    field !== 'symbolData' &&
    stableValue(beforeRecord[field]) !== stableValue(afterRecord[field]),
  );
  const parts: string[] = [];
  if (additions.length) parts.push(`${additions.length} added`);
  if (removals.length) parts.push(`${removals.length} removed`);
  if (updatedWires.length) parts.push(`${updatedWires.length} wire${updatedWires.length === 1 ? '' : 's'} updated`);
  if (updatedComponents.length) parts.push(`${updatedComponents.length} component${updatedComponents.length === 1 ? '' : 's'} updated`);
  if (metadataChanges.length) parts.push(`${metadataChanges.length} circuit setting${metadataChanges.length === 1 ? '' : 's'} changed`);

  const changeCount = additions.length + removals.length +
    updatedWires.length + updatedComponents.length + metadataChanges.length;
  const details = [
    ...additions,
    ...removals,
    ...updatedWires,
    ...updatedComponents,
    ...(metadataChanges.length
      ? [`Changed circuit settings: ${metadataChanges.slice(0, 4).join(', ')}`]
      : []),
  ].slice(0, 6);

  return {
    hasChanges: changeCount > 0,
    changeCount,
    summary: parts.length ? parts.join('; ') : 'No drawing changes detected.',
    details,
  };
}

export function buildExternalCircuitFixProposal(
  before: CircuitSpec,
  pasted: string,
): ExternalCircuitFixProposal {
  const spec = parseExternalCircuitFixSpec(pasted);
  const diff = summarizeExternalCircuitFix(before, spec);
  if (!diff.hasChanges) {
    throw new Error('No drawing changes were found compared with the rejected CircuitSpec.');
  }
  return {
    spec,
    diff,
    summary: `External correction: ${diff.summary}. ${diff.details.join('; ')}`.slice(0, 500),
  };
}

export function partitionExternalCircuitFixFindings(
  validationFindings: string[],
  validationWarnings: string[],
  fallbackMessage: string,
): { reportedProblems: string[]; advisoryWarnings: string[] } {
  const layoutNotes = validationFindings
    .filter((finding) => finding.startsWith('Drawing-quality issue: '))
    .map((finding) => finding.slice('Drawing-quality issue: '.length));
  const blockingFindings = validationFindings.filter(
    (finding) => !finding.startsWith('Drawing-quality issue: '),
  );
  const reportedProblems = blockingFindings.length
    ? blockingFindings
    : [
        layoutNotes.length
          ? 'No CircuitDraw structural blocker remains; the previous attempts were rejected for visual routing notes only.'
          : fallbackMessage || 'Studio rejected the previous response for a format or compatibility issue.',
      ];

  return {
    reportedProblems,
    advisoryWarnings: [...new Set([...validationWarnings, ...layoutNotes])],
  };
}

export function getExternalCircuitFixContextKey(
  context: ExternalCircuitFixContext,
): string {
  return JSON.stringify(context);
}

export function shouldShowExternalCircuitFixPaste(
  copiedContextKey: string | null,
  currentContextKey: string,
): boolean {
  return Boolean(copiedContextKey) && copiedContextKey === currentContextKey;
}

export function buildExternalCircuitFixPrompt(
  context: ExternalCircuitFixContext,
): string {
  return [
    'Correct the listed CircuitStudio drawing findings. Return one complete CircuitSpec as JSON only, with no Markdown or explanation. Preserve the intended circuit and change only what is needed.',
    JSON.stringify({
      request: context.originalRequest.slice(0, 600),
      brief: {
        goal: context.designBrief.goal.slice(0, 300),
        requirements: context.designBrief.requirements.slice(0, 6).map((item) => item.slice(0, 180)),
      },
      findings: context.reportedProblems.slice(0, 8).map((item) => item.slice(0, 500)),
      advisoryWarnings: context.advisoryWarnings.slice(0, 4).map((item) => item.slice(0, 300)),
      circuitSpec: context.rejectedSpec,
    }),
  ].join('\n');
}
