import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type { CircuitDocumentDiagnostic } from "@workspace/circuit-document";
import type { CircuitDocumentV2ElectricalGenerationResult } from "@workspace/api-client-react";
import { CircuitDocumentV2DiagnosticList } from "./circuit-document-v2-diagnostics";

export type CircuitDocumentV2PreviewProjection =
  | { status: "representable"; svg: string; message: string }
  | { status: "not-representable"; message: string }
  | null;

function formatPin(reference: { componentId: string; pinId: string }) {
  return `${reference.componentId}.${reference.pinId}`;
}

export function CircuitDocumentV2ProposalReview({
  proposal,
  projection,
  diagnostics,
  approvalBlockReason,
  actionBusy,
  onApprove,
  onReject,
}: {
  proposal: CircuitDocumentV2ElectricalGenerationResult;
  projection: CircuitDocumentV2PreviewProjection;
  diagnostics: CircuitDocumentDiagnostic[];
  approvalBlockReason: string | null;
  actionBusy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const preparation = proposal.drawingPreparation;
  const statusMessage = {
    ready: "Placement and routing completed. Ready does not establish electrical correctness or safety.",
    partial: "This drawing is incomplete. Inspect the unfinished routes and diagnostics before deciding.",
    blocked: "Drawing preparation was blocked. You can inspect the proposal, but approval is disabled.",
  }[preparation.status];

  return (
    <section className="v2-proposal-review" aria-labelledby="v2-proposal-title">
      <div className="v2-proposal-heading">
        <div>
          <p className="eyebrow">Generated proposal · not saved</p>
          <h2 id="v2-proposal-title" data-testid="text-v2-proposal-title">
            {proposal.document.title || "Untitled proposal"}
          </h2>
          <p className="v2-proposal-summary">{proposal.design.summary}</p>
        </div>
        <span
          className={`v2-proposal-status is-${preparation.status}`}
          role="status"
          data-testid={`status-v2-proposal-${preparation.status}`}
        >
          {preparation.status}
        </span>
      </div>

      <div
        className={`v2-proposal-callout is-${preparation.status}`}
        role="status"
        data-testid="status-v2-drawing-preparation"
      >
        {preparation.status === "ready"
          ? <CheckCircle2 aria-hidden="true" />
          : <AlertTriangle aria-hidden="true" />}
        <p>{statusMessage}</p>
      </div>

      <div className="v2-proposal-stages" aria-label="Drawing preparation stages">
        <div>
          <span>Placement</span>
          <strong data-testid="status-v2-placement">{preparation.stages.placement}</strong>
        </div>
        <div>
          <span>Routing</span>
          <strong data-testid="status-v2-routing">{preparation.stages.routing}</strong>
        </div>
        <div>
          <span>Routed nets</span>
          <strong>{preparation.routedNetIds.length}</strong>
        </div>
        <div>
          <span>Skipped nets</span>
          <strong>{preparation.skippedNetIds.length}</strong>
        </div>
        <div>
          <span>Blocked nets</span>
          <strong data-testid="text-v2-blocked-net-count">
            {preparation.blockedNetIds.length}
          </strong>
        </div>
      </div>
      {preparation.blockedNetIds.length > 0 && (
        <p className="v2-proposal-blocked-nets" data-testid="text-v2-blocked-net-ids">
          Blocked: {preparation.blockedNetIds.join(", ")}
        </p>
      )}

      <div className="v2-proposal-grid">
        <section aria-labelledby="v2-proposal-electrical-heading">
          <h3 id="v2-proposal-electrical-heading">Electrical model</h3>
          <p>
            {proposal.document.electrical.components.length} components ·{" "}
            {proposal.document.electrical.nets.length} nets
          </p>
          <ul className="v2-proposal-list">
            {proposal.document.electrical.components.map((component) => (
              <li key={component.id} data-testid={`row-v2-proposal-component-${component.id}`}>
                <strong>{component.reference || component.id}</strong>
                <span>
                  {component.type}
                  {component.value ? ` · ${component.value}` : ""}
                </span>
                <small>
                  Pins: {component.pins.map((pin) => pin.id).join(", ") || "none"}
                </small>
              </li>
            ))}
          </ul>
          {proposal.document.electrical.components.length === 0 && (
            <p>No components.</p>
          )}

          <h3>Nets and pins</h3>
          <ul className="v2-proposal-list">
            {proposal.document.electrical.nets.map((net) => (
              <li key={net.id} data-testid={`row-v2-proposal-net-${net.id}`}>
                <strong>{net.name || net.id}</strong>
                <small>{net.members.map(formatPin).join(", ") || "No members"}</small>
              </li>
            ))}
          </ul>
          {proposal.document.electrical.nets.length === 0 && <p>No nets.</p>}
          <p className="v2-proposal-pin-states">
            No-connect pins:{" "}
            {proposal.document.electrical.noConnects.map(formatPin).join(", ") || "none"}
            <br />
            Unassigned pins:{" "}
            {proposal.document.electrical.unassignedPins.map(formatPin).join(", ") || "none"}
          </p>
        </section>

        <section aria-labelledby="v2-proposal-preview-heading">
          <h3 id="v2-proposal-preview-heading">Schematic preview</h3>
          {!projection ? (
            <p className="v2-inline-note">CircuitDraw is still loading.</p>
          ) : projection.status === "representable" ? (
            <div
              className="v2-preview-svg"
              role="img"
              aria-label={`${preparation.status} schematic preview of the generated V2 proposal`}
              data-testid="preview-v2-proposal"
              dangerouslySetInnerHTML={{ __html: projection.svg }}
            />
          ) : (
            <div className="v2-projection-blocked" data-testid="preview-v2-proposal-unavailable">
              <AlertTriangle aria-hidden="true" />
              <p>{projection.message}</p>
              <p>The electrical model and preparation diagnostics remain available.</p>
            </div>
          )}
          <p className="v2-proposal-renderer-note">
            Existing legacy-compatible renderer · preview only
          </p>
        </section>
      </div>

      {(proposal.design.assumptions.length > 0 ||
        proposal.design.uncertainties.length > 0 ||
        proposal.design.questions.length > 0) && (
        <section className="v2-proposal-notes" aria-label="Proposal notes">
          {proposal.design.assumptions.length > 0 && (
            <div>
              <h3>Assumptions</h3>
              <ul>{proposal.design.assumptions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </div>
          )}
          {proposal.design.uncertainties.length > 0 && (
            <div>
              <h3>Uncertainties</h3>
              <ul>{proposal.design.uncertainties.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </div>
          )}
          {proposal.design.questions.length > 0 && (
            <div>
              <h3>Open questions</h3>
              <ul>{proposal.design.questions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <section className="v2-proposal-diagnostics" aria-labelledby="v2-proposal-diagnostics-heading">
        <h3 id="v2-proposal-diagnostics-heading">Validation and drawing diagnostics</h3>
        {diagnostics.length > 0
          ? <CircuitDocumentV2DiagnosticList diagnostics={diagnostics} />
          : <p className="v2-valid-note"><CheckCircle2 aria-hidden="true" /> No validation or drawing diagnostics.</p>}
      </section>

      <div className="v2-proposal-actions">
        <button
          className="primary-button"
          type="button"
          disabled={actionBusy || Boolean(approvalBlockReason)}
          onClick={onApprove}
          data-testid="button-approve-v2-proposal"
        >
          {actionBusy ? "Saving proposal…" : preparation.status === "partial" ? "Approve partial proposal" : "Approve as current V2 draft"}
        </button>
        <button
          className="quiet-button"
          type="button"
          disabled={actionBusy}
          onClick={onReject}
          data-testid="button-reject-v2-proposal"
        >
          <X aria-hidden="true" /> Reject proposal
        </button>
      </div>
      {approvalBlockReason ? (
        <p className="v2-approval-block-reason" role="alert" data-testid="text-v2-approval-block-reason">
          {approvalBlockReason}
        </p>
      ) : (
        <p className="v2-approval-note">
          Approval saves this proposal as the current V2 draft. It does not save to the server or change the legacy workbench.
        </p>
      )}
    </section>
  );
}
