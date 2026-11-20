# Circuit Studio build-response review bundle

This folder collects the source and evidence relevant to circuit-build requests, AI responses, saved state, and validation failures. Source files are copied with their original project-relative paths; the project files remain the source of truth.

## What is included

- `artifacts/api-server/src/routes/circuitBuilder.ts` — build/chat prompt, request handling, response parsing, and response-mode enforcement.
- `artifacts/api-server/src/lib/circuitAi.ts` and `providerErrorDiagnostics.ts` — Gemini generation, usage/key handling, and sanitized provider errors.
- `artifacts/api-server/src/lib/circuitSpec.ts` — server-side CircuitSpec parsing.
- `artifacts/circuit-studio/src/components/circuit-builder-chat.tsx` — client mode selection, AI response handling, validation, repair retries, and conversation/brief persistence.
- `artifacts/circuit-studio/src/components/circuit-builder-composer.tsx` — message submission from the composer.
- `artifacts/circuit-studio/src/lib/circuit-build-intent.ts` — local detection of explicit build/chat intent.
- `artifacts/circuit-studio/src/lib/circuit-build-retry.ts` and its test — retry and validation-repair flow.
- `artifacts/circuit-studio/src/App.tsx` — workbench proposal application and saved circuit draft.
- `artifacts/circuit-studio/public/circuit-draw.js` — the actual schematic renderer and structural validator.
- `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated/api.ts`, and `lib/api-client-react/src/generated/*` — request/response contracts and generated client.
- `lib/api-client-react/src/custom-fetch.ts` — browser request/error handling.
- `lib/db/src/schema/circuitAiUsage.ts` — AI usage persistence schema.
- `attached_assets/*` — the server log and screenshot supplied with the report.

## Report context

The supplied screenshot says the proposal still had 21 validation findings after two automatic repair attempts. Visible examples say resistor terminals were 30 px apart although CircuitDraw requires at least 50 px. The supplied API log contains three successful `POST /api/circuits/build-chat` responses, each taking about 34–36 seconds; it does not show an API 502 for those attempts.

The pasted log and screenshot are from before the latest build-intent and spacing-instruction changes in the copied source. The current source recognizes direct wording such as “okay build now” as a build request, keeps Build mode selected through a failed validation cycle, and tells the model CircuitDraw’s minimum terminal distances. A live signed-in generation has not yet verified whether those prompt changes eliminate the findings.

## Suggested prompt for Claude

Review this bundle without editing the project. Trace the request from the user’s message through mode selection, API generation, response storage, validation, and repair retries. Explain why “okay build now” could remain in Chat mode and why the model repeatedly returned invalid component spacing. Check whether the latest changes cover those causes and identify any remaining gaps. Recommend minimal code changes and tests. Do not recommend bypassing structural validation or silently applying an invalid proposal. Treat the attached log as pre-change evidence and do not request or expose secrets.
