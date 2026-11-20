# Circuit Studio

An account-gated circuit workspace for turning plain-language electronics ideas into editable schematics and useful exports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required server env: `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `GEMINI_API_KEY`
- Optional Gemini fallback keys: `GEMINI_API_KEY_2` through `GEMINI_API_KEY_10`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/circuit-studio/src/App.tsx` — public introduction, authenticated workbench, tutor, live review, and exports
- `artifacts/circuit-studio/public/circuit-draw.js` — schematic renderer, structure checks, and EasyEDA sheet builder
- `artifacts/api-server/src/routes/` — authenticated circuit generation, tutor, editor review, usage, and key selection
- `artifacts/api-server/src/lib/circuitAi.ts` — Gemini key selection/fallback and usage tracking
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/api-client-react/` — generated frontend API hooks and schemas
- `lib/db/src/schema/circuitAiUsage.ts` — per-account usage and in-flight request reservations

## Architecture decisions

- Clerk browser sessions use same-origin cookies; circuit generation verifies the session on the server.
- Circuit drafts are stored in browser local storage under a per-user key.
- Gemini is called from the API server so configured keys never reach the browser. Users select among configured key numbers; fallback changes only that account's selection.
- Gemini usage is tracked per account, but Circuit Studio imposes no app-side token cap. Gemini provider quotas and costs still apply.
- Tutor edits are validated and previewed before a user explicitly applies them to the local draft.
- Tutor images are type- and size-checked, sent directly for analysis, and never saved as files or database content.
- Structure validation and AI feedback are not electrical safety or correctness checks.

## Product

Visitors can learn about Circuit Studio and create an account. Signed-in users can generate and refine CircuitSpec schematics, inspect immediate structural warnings, receive debounced educational reviews, ask a separate text/image tutor for explanations or proposed edits, and export SVG, PNG, JSON, or an EasyEDA build sheet.

## User preferences

- In chat mode, natural build requests should switch to Build mode and prepare a proposal. Builder and working-note textareas must stay editable during every AI status, and responses must not overwrite text entered after a request starts.

## Gotchas

- `/api/ai/usage` reads both AI usage tables. After importing the project or changing the DB schema, apply development changes with `pnpm --filter @workspace/db run push`; see `docs/ai-usage-503.md` for diagnosis and production-safe steps.
- Restart `artifacts/api-server: API Server` after API source changes; its development workflow builds the server at startup.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
