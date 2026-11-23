import {
  layoutCircuitDocument,
} from './layout.ts';
import {
  CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
  type CircuitDrawingPreparationMetrics,
  type CircuitDrawingPreparationRequest,
  type CircuitDrawingPreparationResult,
} from './drawing-preparation-types.ts';
import { CIRCUIT_LAYOUT_ALGORITHM_VERSION } from './layout-types.ts';
import type { CircuitDocumentDiagnostic, CircuitDocumentV2 } from './model.ts';
import { validateCircuitDocumentV2 } from './validation.ts';
import { routeCircuitDocument } from './routing.ts';
import { CIRCUIT_ROUTING_ALGORITHM_VERSION } from './routing-types.ts';

const preRouteConsistencyCodes = new Set([
  'net-not-visibly-connected',
  'net-visual-connection-unknown',
  'route-does-not-touch-net-pin',
  'route-has-no-electrical-pins',
  'unmarked-route-crossing',
]);

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function diagnosticKey(diagnostic: CircuitDocumentDiagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.severity,
    diagnostic.path,
    diagnostic.message,
  ]);
}

function uniqueSortedDiagnostics(
  diagnostics: readonly CircuitDocumentDiagnostic[],
): CircuitDocumentDiagnostic[] {
  const unique = new Map<string, CircuitDocumentDiagnostic>();
  for (const entry of diagnostics) unique.set(diagnosticKey(entry), entry);
  return [...unique.values()].sort((left, right) =>
    compareText(left.path, right.path) ||
    compareText(left.code, right.code) ||
    compareText(left.severity, right.severity) ||
    compareText(left.message, right.message)
  );
}

function structuralErrors(
  validation: ReturnType<typeof validateCircuitDocumentV2>,
): CircuitDocumentDiagnostic[] {
  return [
    ...validation.schemaErrors,
    ...validation.electricalErrors,
    ...validation.drawingErrors,
  ];
}

function validationFindings(
  validation: ReturnType<typeof validateCircuitDocumentV2>,
): CircuitDocumentDiagnostic[] {
  return [
    ...structuralErrors(validation),
    ...validation.drawingWarnings,
    ...validation.consistencyWarnings,
  ];
}

function cloneDocument(document: CircuitDocumentV2): CircuitDocumentV2 {
  return JSON.parse(JSON.stringify(document)) as CircuitDocumentV2;
}

function invalidVersionDiagnostic(): CircuitDocumentDiagnostic {
  return {
    code: 'drawing-preparation-version-unsupported',
    severity: 'error',
    path: 'algorithmVersion',
    message:
      `This operation supports only ${CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION}.`,
  };
}

function emptyRoutingMetrics(): NonNullable<
  CircuitDrawingPreparationMetrics['routing']
> {
  return {
    routedNetCount: 0,
    skippedNetCount: 0,
    blockedNetCount: 0,
  };
}

/**
 * Places only unplaced components, then routes eligible nets without existing
 * routes. Existing placements and manual drawing data are never reworked.
 */
export function prepareCircuitDocumentDrawing(
  request: CircuitDrawingPreparationRequest,
): CircuitDrawingPreparationResult {
  const emptyRouteIds = {
    routedNetIds: [],
    skippedNetIds: [],
    blockedNetIds: [],
  };

  if (
    !request ||
    request.algorithmVersion !==
      CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION
  ) {
    return {
      status: 'invalid-input',
      diagnostics: [invalidVersionDiagnostic()],
      stages: { placement: 'not-run', routing: 'not-run' },
      ...emptyRouteIds,
      algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
    };
  }

  const inputValidation = validateCircuitDocumentV2(request.document);
  const inputErrors = structuralErrors(inputValidation);
  if (inputErrors.length > 0) {
    return {
      status: 'invalid-input',
      diagnostics: uniqueSortedDiagnostics(inputErrors),
      stages: { placement: 'not-run', routing: 'not-run' },
      ...emptyRouteIds,
      algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
    };
  }

  const layout = layoutCircuitDocument({
    document: request.document,
    mode: 'place-unplaced',
    ...(request.placementHints ? { hints: request.placementHints } : {}),
    algorithmVersion: CIRCUIT_LAYOUT_ALGORITHM_VERSION,
  });
  if (layout.status === 'blocked') {
    return {
      status: 'placement-blocked',
      document: cloneDocument(request.document),
      diagnostics: uniqueSortedDiagnostics([
        ...inputValidation.drawingWarnings,
        ...inputValidation.consistencyWarnings,
        ...layout.diagnostics,
      ]),
      stages: { placement: 'blocked', routing: 'not-run' },
      ...(layout.metrics ? { metrics: { placement: layout.metrics } } : {}),
      ...emptyRouteIds,
      algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
    };
  }

  const routing = routeCircuitDocument({
    document: layout.document,
    ...(request.routingOptions ? { options: request.routingOptions } : {}),
    algorithmVersion: CIRCUIT_ROUTING_ALGORITHM_VERSION,
  });
  if (routing.status === 'blocked') {
    return {
      status: 'routing-blocked',
      document: layout.document,
      diagnostics: uniqueSortedDiagnostics([
        ...layout.diagnostics,
        ...routing.diagnostics,
      ]),
      stages: { placement: 'complete', routing: 'blocked' },
      metrics: {
        placement: layout.metrics,
        routing: emptyRoutingMetrics(),
      },
      ...emptyRouteIds,
      algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
    };
  }

  const finalValidation = validateCircuitDocumentV2(routing.document);
  const finalErrors = structuralErrors(finalValidation);
  const finalFindings = validationFindings(finalValidation);
  if (finalErrors.length > 0) {
    return {
      status: 'routing-blocked',
      document: layout.document,
      diagnostics: uniqueSortedDiagnostics([
        ...layout.diagnostics,
        ...routing.diagnostics,
        ...finalFindings,
      ]),
      stages: { placement: 'complete', routing: 'blocked' },
      metrics: {
        placement: layout.metrics,
        routing: {
          routedNetCount: routing.routedNetIds.length,
          skippedNetCount: routing.skippedNetIds.length,
          blockedNetCount: routing.blockedNetIds.length,
        },
      },
      ...emptyRouteIds,
      algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
    };
  }

  const finalConsistencyKeys = new Set(
    finalValidation.consistencyWarnings.map(diagnosticKey),
  );
  const currentLayoutDiagnostics = layout.diagnostics.filter((entry) =>
    !preRouteConsistencyCodes.has(entry.code) ||
    finalConsistencyKeys.has(diagnosticKey(entry))
  );
  const diagnostics = uniqueSortedDiagnostics([
    ...currentLayoutDiagnostics,
    ...routing.diagnostics,
    ...finalFindings,
  ]);
  const partialDrawing =
    routing.status === 'incomplete' ||
    finalValidation.consistencyWarnings.length > 0;
  const metrics: CircuitDrawingPreparationMetrics = {
    placement: layout.metrics,
    routing: {
      routedNetCount: routing.routedNetIds.length,
      skippedNetCount: routing.skippedNetIds.length,
      blockedNetCount: routing.blockedNetIds.length,
    },
  };
  const routeIds = {
    routedNetIds: routing.routedNetIds,
    skippedNetIds: routing.skippedNetIds,
    blockedNetIds: routing.blockedNetIds,
  };
  const stages = {
    placement: 'complete' as const,
    routing: routing.status,
  };
  const common = {
    document: routing.document,
    diagnostics,
    stages,
    metrics,
    ...routeIds,
    algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
  };

  if (partialDrawing) return { status: 'partial', ...common };
  return {
    status: 'complete',
    ...common,
    stages: { placement: 'complete', routing: 'complete' },
  };
}
