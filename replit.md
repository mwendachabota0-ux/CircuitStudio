# Circuit Studio

An account-gated circuit workspace for turning plain-language electronics ideas into editable schematics and useful exports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required server env: `NEON_DATABASE_URL` (preferred for the Circuit Studio Neon database; falls back to Replit-managed `DATABASE_URL`), `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `GEMINI_API_KEY`
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
- `lib/circuit-geometry/src/index.ts` — shared component catalog, required schemas, pin coordinates, and AI compatibility guide
- `docs/circuit-component-reference.md` — developer-facing component schemas, pin coordinates, and validation limits
- `docs/kicad-symbol-library.md` — KiCad source, licensing, import flow, renderer coverage, and agent rules
- `artifacts/api-server/src/routes/` — authenticated circuit generation, tutor, editor review, usage, and key selection
- `artifacts/api-server/src/lib/circuitAi.ts` — Gemini key selection/fallback and usage tracking
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/api-client-react/` — generated frontend API hooks and schemas
- `lib/db/src/schema/circuitAiUsage.ts` — per-account usage and in-flight request reservations

## Architecture decisions

- Clerk browser sessions use same-origin cookies; circuit generation verifies the session on the server.
- Circuit drafts are stored in browser local storage under a per-user key.
- Gemini is called from the API server so configured keys never reach the browser. Users select among configured key numbers; fallback changes only that account's selection.
- Keep the Neon connection string and application credentials in Replit Secrets; never store secrets in PostgreSQL.
- Gemini usage is tracked per account, but Circuit Studio imposes no app-side token cap. Gemini provider quotas and costs still apply.
- Tutor edits are validated and previewed before a user explicitly applies them to the local draft.
- Tutor images are type- and size-checked, sent directly for analysis, and never saved as files or database content.
- Structure validation and AI feedback are not electrical safety or correctness checks.
- Use KiCad's official symbol library as the broad symbol source. Keep a compact searchable index in the app and load full symbol definitions only when needed, with attribution and license terms retained.
- Preserve imported symbol pin positions and drawing geometry in each draft so a schematic stays inspectable without requiring CAD software or circuit simulation.
- Do not bulk-vendor the full upstream symbol repository. The compressed index is local; full version-pinned definitions are loaded on demand and failures must be explicit, never silently replaced with guessed symbols.

## Product

Circuit Studio helps makers and engineers draft a clear schematic before moving the design into full CAD tools such as EasyEDA or KiCad. It is for sketching and reviewing a draft, not a CAD replacement, free-placement editor, or circuit simulator. Keep source symbol pin geometry visible and avoid implying that a structural drawing check proves electrical correctness or safety.

## User preferences

- In Chat mode, inferred circuit intent must stay in Chat and ask permission before preparing a schematic. A direct build/draw/create request, manually selecting Build, or explicitly accepting the permission question counts as approval. All text editors, including CircuitSpec JSON and pasted-fix JSON, must stay editable during every AI status; responses must not overwrite text entered after a request starts.

## Gotchas

- `/api/ai/usage` reads both AI usage tables. After importing the project or changing the DB schema, apply development changes with `pnpm --filter @workspace/db run push`; see `docs/ai-usage-503.md` for diagnosis and production-safe steps.
- Restart `artifacts/api-server: API Server` after API source changes; its development workflow builds the server at startup.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
