import type { CircuitDocumentDiagnostic } from "@workspace/circuit-document";

export function CircuitDocumentV2DiagnosticList({
  diagnostics,
}: {
  diagnostics: CircuitDocumentDiagnostic[];
}) {
  return (
    <ul className="v2-diagnostic-list" data-testid="list-v2-diagnostics">
      {diagnostics.map((diagnostic, index) => (
        <li
          key={`${diagnostic.code}-${diagnostic.path}-${index}`}
          className={`is-${diagnostic.severity}`}
          data-testid={`diagnostic-v2-${diagnostic.code}-${index}`}
        >
          <span>{diagnostic.severity}</span>
          <strong>{diagnostic.code}</strong>
          {diagnostic.path && <code>{diagnostic.path}</code>}
          <p>{diagnostic.message}</p>
        </li>
      ))}
    </ul>
  );
}
