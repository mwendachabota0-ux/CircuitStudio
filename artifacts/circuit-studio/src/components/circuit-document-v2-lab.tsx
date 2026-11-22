import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CloudOff,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import {
  useLoadCircuitDocumentV2Draft,
  useSaveCircuitDocumentV2Draft,
} from "@workspace/api-client-react";
import { validateCircuitDocumentV2 } from "@workspace/circuit-document";
import type {
  CircuitDocumentV2,
  CircuitDocumentV2Draft,
  CircuitDraftStorage,
  CircuitDraftStorageLoadResult,
  CircuitDocumentDiagnostic,
  LegacyCircuitSpec,
  LegacyCircuitTools,
} from "@workspace/circuit-document";
import {
  canAccessCircuitDocumentV2Lab,
  createCircuitDocumentV2Copy,
  getCircuitDocumentV2DocumentSessionId,
  loadCircuitDocumentV2LocalDraft,
  loadCircuitDocumentV2SessionId,
  projectCircuitDocumentToLegacy,
  reconcileCircuitDraftCopies,
  saveCircuitDocumentV2LocalFirst,
  type CircuitDocumentV2FeatureFlags,
} from "@/lib/circuit-document-v2-lab";
import "./circuit-document-v2-lab.css";

type CircuitDrawWithMembership = NonNullable<typeof window.CircuitDraw> & {
  netlistWithMembership?: LegacyCircuitTools["netlistWithMembership"];
};

type SyncState =
  | { kind: "disabled" | "empty" | "checking" | "local-only" }
  | {
      kind: "server-only" | "identical";
      serverDraft: CircuitDocumentV2Draft;
      revision: number;
    }
  | {
      kind: "conflict";
      localValue: unknown | null;
      serverDraft: CircuitDocumentV2Draft;
      revision: number;
      message: string;
    }
  | { kind: "unavailable"; message: string };

type Props = {
  userId: string;
  isSignedIn: boolean;
  currentLegacySpec: LegacyCircuitSpec | null;
  circuitDrawReady: boolean;
  featureFlags: CircuitDocumentV2FeatureFlags;
  onBack: () => void;
};

function getBrowserStorage(): CircuitDraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function initialLocalDraft(
  storage: CircuitDraftStorage | null,
  userId: string,
): CircuitDraftStorageLoadResult {
  return loadCircuitDocumentV2LocalDraft(storage, userId);
}

function readLocalValue(result: CircuitDraftStorageLoadResult): unknown | null {
  if (result.status === "v2") return result.draft;
  if (result.status === "quarantined") return result.rawValue ?? null;
  return null;
}

function circuitDrawTools(): {
  draw: NonNullable<typeof window.CircuitDraw>;
  tools: LegacyCircuitTools;
} | null {
  const draw = window.CircuitDraw as CircuitDrawWithMembership | undefined;
  if (!draw || typeof draw.netlistWithMembership !== "function") return null;
  return {
    draw,
    tools: {
      validate: (spec) =>
        draw.validate(
          spec as unknown as Parameters<typeof draw.validate>[0],
        ),
      netlistWithMembership: (spec, allowStructuralErrors) =>
        draw.netlistWithMembership!(
          spec as unknown as Parameters<
            NonNullable<typeof draw.netlistWithMembership>
          >[0],
          allowStructuralErrors,
        ),
    },
  };
}

function formatPin(reference: { componentId: string; pinId: string }) {
  return `${reference.componentId}.${reference.pinId}`;
}

function diagnosticsFor(document: CircuitDocumentV2): CircuitDocumentDiagnostic[] {
  const validation = validateCircuitDocumentV2(document);
  return [
    ...validation.schemaErrors,
    ...validation.electricalErrors,
    ...validation.drawingErrors,
    ...validation.drawingWarnings,
    ...validation.consistencyWarnings,
  ];
}

export default function CircuitDocumentV2Lab({
  userId,
  isSignedIn,
  currentLegacySpec,
  circuitDrawReady,
  featureFlags,
  onBack,
}: Props) {
  const storage = useMemo(() => getBrowserStorage(), []);
  const [localState, setLocalState] = useState(() =>
    initialLocalDraft(storage, userId),
  );
  const [document, setDocument] = useState<CircuitDocumentV2 | null>(() =>
    localState.status === "v2" ? localState.draft.document : null,
  );
  const [sessionId, setSessionId] = useState<string | null>(() => {
    const storedDocument =
      localState.status === "v2" ? localState.draft.document : null;
    return (
      (storedDocument
        ? getCircuitDocumentV2DocumentSessionId(storedDocument)
        : null) ??
      (storage ? loadCircuitDocumentV2SessionId(storage, userId) : null)
    );
  });
  const [localSaveState, setLocalSaveState] = useState<
    "saved" | "empty" | "quarantined" | "unsaved" | "failed"
  >(() => {
    if (localState.status === "v2") return "saved";
    if (localState.status === "quarantined") return "quarantined";
    return "empty";
  });
  const [importDiagnostics, setImportDiagnostics] = useState<
    CircuitDocumentDiagnostic[]
  >([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>(() =>
    featureFlags.serverSyncEnabled ? { kind: "checking" } : { kind: "disabled" },
  );

  const sessionForQuery = sessionId ?? "v2-session-unavailable";
  const serverQuery = useLoadCircuitDocumentV2Draft(sessionForQuery, {
    query: {
      enabled: featureFlags.serverSyncEnabled && Boolean(sessionId),
      retry: false,
      refetchOnWindowFocus: false,
    },
  });
  const remoteSave = useSaveCircuitDocumentV2Draft();

  useEffect(() => {
    if (!featureFlags.serverSyncEnabled) {
      setSyncState({ kind: "disabled" });
      return;
    }
    if (!sessionId) {
      setSyncState({ kind: "local-only" });
      return;
    }
    if (serverQuery.isFetching) {
      setSyncState({ kind: "checking" });
      return;
    }
    if (serverQuery.isError) {
      setSyncState({
        kind: "unavailable",
        message: "Saved locally; server sync unavailable.",
      });
      return;
    }
    const response = serverQuery.data;
    if (!response) return;
    if (response.status === "empty") {
      setSyncState({ kind: "local-only" });
      return;
    }

    const serverDraft = response.draft as CircuitDocumentV2Draft;
    const localValue = readLocalValue(localState);
    const reconciliation = reconcileCircuitDraftCopies(
      localValue,
      serverDraft,
    );
    if (localState.status === "empty") {
      setSyncState({
        kind: "server-only",
        serverDraft,
        revision: response.revision,
      });
      return;
    }
    if (reconciliation.status === "resolved") {
      setSyncState({
        kind: "identical",
        serverDraft,
        revision: response.revision,
      });
      return;
    }
    if (reconciliation.status === "empty") {
      setSyncState({
        kind: "server-only",
        serverDraft,
        revision: response.revision,
      });
      return;
    }
    setSyncState({
      kind: "conflict",
      localValue,
      serverDraft,
      revision: response.revision,
      message: reconciliation.message,
    });
  }, [
    featureFlags.serverSyncEnabled,
    localState,
    serverQuery.data,
    serverQuery.isError,
    serverQuery.isFetching,
    sessionId,
  ]);

  const diagnostics = document ? diagnosticsFor(document) : [];
  const projection = useMemo(() => {
    if (!document || !circuitDrawReady) return null;
    const runtime = circuitDrawTools();
    if (!runtime) return null;
    const projected = projectCircuitDocumentToLegacy(document, runtime.tools);
    if (projected.status !== "representable" || !projected.spec) {
      return {
        status: "not-representable" as const,
        message:
          projected.diagnostics.map((item) => item.message).join(" ") ||
          "This V2 document contains information the legacy preview cannot preserve.",
      };
    }
    const report = runtime.tools.validate(projected.spec);
    if (report.errors.length > 0) {
      return {
        status: "not-representable" as const,
        message: report.errors.join(" "),
      };
    }
    return {
      status: "representable" as const,
      svg: runtime.draw.render(
        projected.spec as unknown as Parameters<typeof runtime.draw.render>[0],
      ),
      message: "",
    };
  }, [document, circuitDrawReady]);

  const saveLocally = async (
    targetDocument: CircuitDocumentV2,
    targetSessionId: string | null,
    sync: boolean,
    expectedRevision: number,
  ) => {
    setActionBusy(true);
    setStatusMessage("");
    const result = await saveCircuitDocumentV2LocalFirst({
      storage,
      userId,
      document: targetDocument,
      sessionId: targetSessionId,
      serverSyncEnabled: sync && featureFlags.serverSyncEnabled,
      expectedRevision,
      saveRemote: async ({ sessionId: remoteSessionId, expectedRevision: revision, draft }) => {
        const saved = await remoteSave.mutateAsync({
          sessionId: remoteSessionId,
          data: { expectedRevision: revision, draft },
        });
        return { revision: saved.revision };
      },
    });

    if (result.status === "local-save-failed") {
      setLocalSaveState("failed");
      setStatusMessage(result.message);
      setActionBusy(false);
      return result;
    }

    setDocument(targetDocument);
    setSessionId(targetSessionId);
    setLocalState({
      status: "v2",
      draft: result.draft,
    });
    setLocalSaveState("saved");

    if (result.status === "synced") {
      setSyncState({
        kind: "identical",
        serverDraft: result.draft,
        revision: result.revision,
      });
      setStatusMessage("Saved locally and synced to the V2 server.");
    } else if (result.status === "revision-conflict") {
      const refreshed = await serverQuery.refetch();
      if (!refreshed.isError && refreshed.data?.status === "loaded") {
        const serverDraft = refreshed.data.draft as CircuitDocumentV2Draft;
        const reconciliation = reconcileCircuitDraftCopies(
          result.draft,
          serverDraft,
        );
        if (reconciliation.status === "resolved") {
          setSyncState({
            kind: "identical",
            serverDraft,
            revision: refreshed.data.revision,
          });
          setStatusMessage(
            "Saved locally. The latest server copy already matches; no second write was needed.",
          );
        } else {
          setSyncState({
            kind: "conflict",
            localValue: result.draft,
            serverDraft,
            revision: refreshed.data.revision,
            message:
              reconciliation.status === "quarantined"
                ? reconciliation.message
                : "The saved local and latest server copies differ.",
          });
          setStatusMessage(
            "Saved locally. The server changed before this save; both copies are preserved. Choose which copy to keep.",
          );
        }
      } else if (!refreshed.isError && refreshed.data?.status === "empty") {
        setSyncState({ kind: "local-only" });
        setStatusMessage(
          "Saved locally. The server session is empty; no remote overwrite was attempted.",
        );
      } else {
        setSyncState({
          kind: "unavailable",
          message: `${result.message} Check the server before trying again.`,
        });
        setStatusMessage(
          "Saved locally. The server revision could not be checked; no retry was attempted.",
        );
      }
    } else if (result.status === "server-unavailable") {
      setSyncState({ kind: "unavailable", message: result.message });
      setStatusMessage("Saved locally; server sync unavailable.");
    } else {
      setStatusMessage("V2 draft saved locally.");
    }
    setActionBusy(false);
    return result;
  };

  const createFromLegacy = async () => {
    if (!currentLegacySpec) return;
    const runtime = circuitDrawTools();
    if (!runtime) {
      setStatusMessage(
        "CircuitDraw membership data is not available; the legacy draft was not imported.",
      );
      return;
    }
    setActionBusy(true);
    setStatusMessage("");
    try {
      const result = createCircuitDocumentV2Copy(
        currentLegacySpec,
        runtime.tools,
      );
      setImportDiagnostics(result.diagnostics);
      if (result.status === "blocked") {
        setStatusMessage(
          "The legacy draft could not be imported safely. It has not been changed or saved to V2.",
        );
        setActionBusy(false);
        return;
      }

      setDocument(result.document);
      setSessionId(result.sessionId);
      setLocalSaveState("unsaved");
      const saved = await saveLocally(
        result.document,
        result.sessionId,
        featureFlags.serverSyncEnabled,
        0,
      );
      if (saved.status === "local-save-failed") {
        setStatusMessage(
          "The V2 copy is available for this screen, but local storage did not save it. Retry the local save before leaving.",
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "A V2 copy could not be created.",
      );
      setActionBusy(false);
    }
  };

  const restoreLocal = () => {
    const restored = initialLocalDraft(storage, userId);
    setLocalState(restored);
    if (restored.status === "v2") {
      setDocument(restored.draft.document);
      const restoredSession =
        getCircuitDocumentV2DocumentSessionId(restored.draft.document) ??
        (storage ? loadCircuitDocumentV2SessionId(storage, userId) : null);
      setSessionId(restoredSession);
      setLocalSaveState("saved");
      setStatusMessage("Restored the V2 draft for this signed-in account.");
      return;
    }
    if (restored.status === "quarantined") {
      setDocument(null);
      setLocalSaveState("quarantined");
      setStatusMessage(
        "The stored V2 value is quarantined and has been left unchanged for recovery.",
      );
      return;
    }
    setDocument(null);
    setSessionId(
      storage ? loadCircuitDocumentV2SessionId(storage, userId) : null,
    );
    setLocalSaveState("empty");
    setStatusMessage(
      "There is no V2 local draft. The legacy CircuitSpec was not imported.",
    );
  };

  const useServerCopy = () => {
    if (syncState.kind !== "server-only" && syncState.kind !== "conflict") return;
    const target = syncState.serverDraft.document;
    const targetSession =
      getCircuitDocumentV2DocumentSessionId(target) ?? sessionId;
    void saveLocally(target, targetSession, false, 0);
  };

  const keepLocalCopy = () => {
    if (localState.status !== "v2" || syncState.kind !== "conflict") return;
    void saveLocally(
      localState.draft.document,
      sessionId,
      true,
      syncState.revision,
    );
  };

  const syncLocalCopy = () => {
    if (!document || !sessionId) return;
    const revision =
      serverQuery.data?.status === "loaded"
        ? serverQuery.data.revision
        : 0;
    void saveLocally(document, sessionId, true, revision);
  };

  const localCopyForConflict =
    localState.status === "v2" ? localState.draft : null;

  if (
    !canAccessCircuitDocumentV2Lab(
      featureFlags.labEnabled,
      isSignedIn,
      userId,
    )
  ) {
    return null;
  }

  return (
    <main className="studio-shell v2-lab-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><ShieldCheck aria-hidden="true" /></span>
          <span>Circuit Studio</span>
        </div>
        <div className="v2-lab-header-tools">
          <span className="v2-lab-tag">V2 DRAFT LAB</span>
          <button className="quiet-button v2-back-button" type="button" onClick={onBack}>
            <ArrowLeft aria-hidden="true" /> Back to workbench
          </button>
        </div>
      </header>

      <div className="workspace v2-lab-workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Separate from the legacy workbench</p>
            <h1>V2 Draft Workspace</h1>
            <p className="subheading">
              Create an explicit, read-only V2 copy. The original CircuitSpec stays unchanged.
            </p>
          </div>
          <div className={`v2-local-status is-${localSaveState}`} role="status">
            {!featureFlags.serverSyncEnabled
              ? <><CloudOff aria-hidden="true" /> Local only</>
              : localSaveState === "saved"
                ? <><CheckCircle2 aria-hidden="true" /> Saved locally</>
                : "Not saved"}
          </div>
        </div>

        <section className="v2-sync-banner" aria-live="polite">
          {!featureFlags.serverSyncEnabled ? (
            <>
              <CloudOff aria-hidden="true" />
              <div>
                <strong>Local only</strong>
                <p>
                  {featureFlags.serverSyncBlockedByDatabase
                    ? "Server sync was requested but remains blocked until the development database and V2 table are verified. No V2 API write is attempted."
                    : "Server sync is off by default. This V2 copy stays in this signed-in account's browser storage; the legacy workbench is unchanged."}
                </p>
              </div>
            </>
          ) : syncState.kind === "checking" ? (
            <>
              <LoaderCircle className="v2-spin" aria-hidden="true" />
              <div><strong>Checking the V2 session</strong><p>No write will occur until a local copy is saved.</p></div>
            </>
          ) : syncState.kind === "unavailable" ? (
            <>
              <AlertTriangle aria-hidden="true" />
              <div><strong>Saved locally; server sync unavailable</strong><p>{syncState.message}</p></div>
            </>
          ) : (
            <>
              <CheckCircle2 aria-hidden="true" />
              <div>
                <strong>{syncState.kind === "identical" ? "Local and server copies match" : "Local-first V2 storage"}</strong>
                <p>{syncState.kind === "identical" ? "The same validated document is available in both places." : "Your work is saved in this signed-in account's separate V2 browser storage."}</p>
              </div>
            </>
          )}
        </section>

        {statusMessage && (
          <p className="v2-action-message" role="status">{statusMessage}</p>
        )}

        {localState.status === "quarantined" && !document && (
          <section className="panel v2-quarantine" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <h2>Stored V2 data needs recovery</h2>
              <p>{localState.message}</p>
              <p>The original stored value has not been overwritten or deleted.</p>
              {localState.rawValue && (
                <details>
                  <summary>Inspect preserved raw value</summary>
                  <pre>{localState.rawValue}</pre>
                </details>
              )}
              <button className="quiet-button" type="button" onClick={restoreLocal}>
                <RefreshCw aria-hidden="true" /> Check again
              </button>
            </div>
          </section>
        )}

        {!document && localState.status !== "quarantined" && (
          <section className="panel v2-empty-state">
            <div className="v2-empty-icon"><ShieldCheck aria-hidden="true" /></div>
            <p className="eyebrow">Explicit import only</p>
            <h2>No V2 draft is saved for this account.</h2>
            <p>
              Create a separate V2 copy from the currently selected legacy draft. Import uses CircuitDraw's exact pin and route membership report; ambiguous or untrusted designs are blocked.
            </p>
            <div className="v2-empty-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!currentLegacySpec || !circuitDrawReady || actionBusy}
                onClick={() => void createFromLegacy()}
              >
                {actionBusy ? <LoaderCircle className="v2-spin" /> : <Save />}
                Create V2 copy from current draft
              </button>
              <button className="quiet-button" type="button" onClick={restoreLocal}>
                <RefreshCw aria-hidden="true" /> Restore local V2 draft
              </button>
            </div>
            {!circuitDrawReady && (
              <p className="v2-inline-note">CircuitDraw is still loading. The legacy draft remains available.</p>
            )}
          </section>
        )}

        {importDiagnostics.length > 0 && (
          <section className="panel v2-diagnostics">
            <h2>Legacy import diagnostics</h2>
            <DiagnosticList diagnostics={importDiagnostics} />
          </section>
        )}

        {document && (
          <>
            <div className="v2-document-toolbar">
              <div>
                <p className="eyebrow">Validated CircuitDocumentV2</p>
                <h2>{document.title || "Untitled V2 document"}</h2>
                <p className="v2-identity">
                  Document <code>{document.id}</code>
                  <span aria-hidden="true"> · </span>
                  Session <code>{sessionId || "not assigned"}</code>
                </p>
              </div>
              <div className="v2-document-actions">
                <button
                  className="quiet-button"
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void saveLocally(document, sessionId, false, 0)}
                >
                  <Save aria-hidden="true" /> Save locally
                </button>
                <button className="quiet-button" type="button" onClick={restoreLocal}>
                  <RefreshCw aria-hidden="true" /> Restore local
                </button>
                {featureFlags.serverSyncEnabled && syncState.kind === "local-only" && (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={actionBusy || !sessionId}
                    onClick={syncLocalCopy}
                  >
                    <RefreshCw aria-hidden="true" /> Sync local copy
                  </button>
                )}
                {featureFlags.serverSyncEnabled && (
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void serverQuery.refetch()}
                  >
                    <RefreshCw aria-hidden="true" /> Check server
                  </button>
                )}
              </div>
            </div>

            {(syncState.kind === "server-only" || syncState.kind === "conflict") && (
              <section className="panel v2-conflict" role="alert">
                <div className="v2-conflict-heading">
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <h2>{syncState.kind === "conflict" ? "Local and server drafts differ" : "A server-only V2 draft was found"}</h2>
                    <p>
                      {syncState.kind === "conflict"
                        ? "Both copies are preserved. Choose which one to use; the other is not replaced until the selected save succeeds."
                        : "The server copy is available under this V2 session. It will not replace local data until you choose it."}
                    </p>
                  </div>
                </div>
                {syncState.kind === "conflict" && <p className="v2-conflict-reason">{syncState.message}</p>}
                <div className="v2-conflict-copies">
                  <div>
                    <strong>Local copy</strong>
                    <span>{localCopyForConflict?.document.id ?? "Unreadable or unavailable"}</span>
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={!localCopyForConflict || actionBusy}
                      onClick={keepLocalCopy}
                    >
                      Keep local and replace server revision {syncState.revision}
                    </button>
                  </div>
                  <div>
                    <strong>Server copy</strong>
                    <span>{syncState.serverDraft.document.id}</span>
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={actionBusy}
                      onClick={useServerCopy}
                    >
                      Use server and replace local storage
                    </button>
                  </div>
                </div>
              </section>
            )}

            <div className="v2-summary-grid">
              <section className="panel v2-summary-card">
                <h2>Electrical structure</h2>
                <p className="v2-count-line">
                  {document.electrical.components.length} components · {document.electrical.nets.length} nets
                </p>
                <ul className="v2-summary-list">
                  {document.electrical.components.map((component) => (
                    <li key={component.id}>
                      <strong>{component.reference || component.id}</strong>
                      <span>{component.type}{component.value ? ` · ${component.value}` : ""}</span>
                      <small>{component.pins.length} defined pins: {component.pins.map((pin) => pin.id).join(", ") || "none"}</small>
                    </li>
                  ))}
                </ul>
                {document.electrical.components.length === 0 && <p className="v2-empty-list">No components.</p>}
              </section>
              <section className="panel v2-summary-card">
                <h2>Nets and member pins</h2>
                <ul className="v2-summary-list">
                  {document.electrical.nets.map((net) => (
                    <li key={net.id}>
                      <strong>{net.name || net.id}</strong>
                      <span>Net ID: {net.id}</span>
                      <small>{net.members.map(formatPin).join(", ") || "No members"}</small>
                    </li>
                  ))}
                </ul>
                {document.electrical.nets.length === 0 && <p className="v2-empty-list">No nets.</p>}
              </section>
              <section className="panel v2-summary-card">
                <h2>Pin states</h2>
                <PinList title="No-connect pins" pins={document.electrical.noConnects} />
                <PinList title="Unassigned pins" pins={document.electrical.unassignedPins} />
              </section>
              <section className="panel v2-summary-card">
                <h2>Drawing data</h2>
                <div className="v2-count-grid">
                  <Count label="Placements" value={document.drawing.placements.length} />
                  <Count label="Routes" value={document.drawing.routes.length} />
                  <Count label="Junctions" value={document.drawing.junctions.length} />
                  <Count label="Crossings" value={document.drawing.crossings.length} />
                  <Count label="Annotations" value={document.drawing.annotations.length} />
                </div>
              </section>
            </div>

            <section className="panel v2-preview-panel">
              <div className="v2-section-heading">
                <div>
                  <p className="eyebrow">Existing renderer only</p>
                  <h2>Legacy-compatible preview</h2>
                </div>
                <span className="v2-projection-label">Projection · not a native V2 renderer</span>
              </div>
              {!circuitDrawReady ? (
                <p className="v2-inline-note">CircuitDraw is still loading.</p>
              ) : projection?.status === "representable" ? (
                <div
                  className="v2-preview-svg"
                  role="img"
                  aria-label="Legacy-compatible preview of the V2 document"
                  dangerouslySetInnerHTML={{ __html: projection.svg }}
                />
              ) : (
                <div className="v2-projection-blocked">
                  <AlertTriangle aria-hidden="true" />
                  <p>{projection?.message || "A safe legacy-compatible preview is unavailable."}</p>
                  <p>The structured V2 document above remains available without a fabricated drawing.</p>
                </div>
              )}
            </section>

            <section className="panel v2-diagnostics">
              <h2>Validation diagnostics</h2>
              {diagnostics.length > 0
                ? <DiagnosticList diagnostics={diagnostics} />
                : <p className="v2-valid-note"><CheckCircle2 aria-hidden="true" /> No schema, electrical, drawing, or consistency issues.</p>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function PinList({
  title,
  pins,
}: {
  title: string;
  pins: Array<{ componentId: string; pinId: string }>;
}) {
  return (
    <div className="v2-pin-list">
      <h3>{title} <span>{pins.length}</span></h3>
      {pins.length > 0 ? (
        <ul>{pins.map((pin) => <li key={`${pin.componentId}.${pin.pinId}`}>{formatPin(pin)}</li>)}</ul>
      ) : (
        <p>None recorded.</p>
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="v2-count"><strong>{value}</strong><span>{label}</span></div>;
}

function DiagnosticList({ diagnostics }: { diagnostics: CircuitDocumentDiagnostic[] }) {
  return (
    <ul className="v2-diagnostic-list">
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.code}-${diagnostic.path}-${index}`} className={`is-${diagnostic.severity}`}>
          <span>{diagnostic.severity}</span>
          <strong>{diagnostic.code}</strong>
          {diagnostic.path && <code>{diagnostic.path}</code>}
          <p>{diagnostic.message}</p>
        </li>
      ))}
    </ul>
  );
}
