import { circuitDocumentV2DraftPersistence } from "../lib/circuitDocumentDraftRepository";
import { createCircuitDocumentV2DraftRouter } from "./circuitDocumentDrafts";

export default createCircuitDocumentV2DraftRouter({
  persistence: circuitDocumentV2DraftPersistence,
});
