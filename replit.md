# Circuit Solver

An interactive browser app for analyzing linear DC circuits and showing the calculation results.

## Run & Operate

- `pnpm --filter @workspace/circuit-solver run dev` — run the Circuit Solver web app
- `pnpm --filter @workspace/circuit-solver run typecheck` — typecheck the web app
- `pnpm --filter @workspace/circuit-solver run build` — build the web app
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

- `artifacts/circuit-solver/src/lib/circuit.ts` — circuit types, DC solver, equivalent-circuit calculations, and mesh analysis
- `artifacts/circuit-solver/src/` — the Circuit Solver interface
- `artifacts/api-server/` — shared API service
- `lib/api-spec/openapi.yaml` — shared API contract

## Architecture decisions

- Circuit calculations run in the browser; no account or database is needed for the core solver.
- Image-based circuit recognition must only be presented as available when its vision service is configured; the original PHP endpoint was not part of the supplied code.

## Product

- Users enter a circuit, choose DC quantities to calculate, and inspect node, branch, power, equivalent-circuit, and mesh-analysis results.

## User preferences

_None stated._

## Gotchas

- Node `0` is ground; branch current and element voltage use the element's positive-to-negative terminal direction.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
