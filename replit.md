# Circuit Studio

An account-gated circuit workspace for turning plain-language electronics ideas into editable schematics and useful exports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/circuit-studio/` — public introduction, Clerk sign-in, and circuit workbench
- `artifacts/circuit-studio/public/circuit-draw.js` — schematic renderer, structure checks, and EasyEDA sheet builder
- `artifacts/api-server/src/routes/circuits.ts` — authenticated Gemini schematic generation
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/api-client-react/` — generated frontend API hooks and schemas

## Architecture decisions

- Clerk browser sessions use same-origin cookies; circuit generation verifies the session on the server.
- Circuit drafts are stored in browser local storage under a per-user key.
- Gemini is called from the API server so the configured key is never sent to the browser.
- Structure validation is not an electrical safety or correctness check.

## Product

Visitors can learn about Circuit Studio and create an account. Signed-in users can generate and refine CircuitSpec schematics, review structural warnings, and export SVG, PNG, JSON, or an EasyEDA build sheet.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
