# Fixing `/api/ai/usage` returning 503

## What caused this

The endpoint reads `circuit_studio_ai_usage` and
`circuit_studio_ai_reservations`. If either table is missing or the database is
unreachable, the API returns 503 instead of showing incorrect usage. This can
happen after importing the source code into a workspace because importing files
does not apply the Drizzle schema to the development database.

The API server also builds its bundle when its workflow starts. After importing
or changing API code, an old running process can continue serving the previous
bundle until that workflow is restarted.

## Diagnose the response

1. Check that the API is running and that `GET /api/healthz` returns 200.
2. Check the API Server workflow logs for `usage_read_failed`. The log includes
   safe diagnostic fields such as the PostgreSQL error code and table name, but
   not SQL parameters or credentials.
3. A 404 for `/api/ai/usage` while `/api/healthz` returns 200 usually means the
   server has an old bundle. Restart the `artifacts/api-server: API Server`
   workflow, then check the endpoint again.
4. A 401 from `/api/ai/usage` without a signed-in Clerk session is expected; it
   confirms that the route is registered. Check the signed-in app for the
   authenticated response.

## Repair the development database

Run this from the workspace root. It applies the current Drizzle schema to the
development database:

```bash
pnpm --filter @workspace/db run push
```

Confirm the tables exist in the development database:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'circuit_studio_ai_usage',
    'circuit_studio_ai_reservations'
  )
ORDER BY table_name;
```

Restart the API Server workflow after code changes. Then reload the signed-in
Circuit Studio page and retry the usage request.

## Prevent it from recurring

The configured post-merge setup runs `scripts/post-merge.sh`, which installs
locked dependencies and applies the development schema. Keep that script
pointing at `@workspace/db` whenever the database package changes. For a new
workspace import, run the development schema push above once if the database
tables are absent.

## Production

Do not run the development `push` command against a production database or add
schema mutations to server startup. For Replit-managed PostgreSQL, publish the
project after the schema is correct in development; Replit applies the schema
diff to production during Publish. If production still returns 503 after
publishing, inspect the deployment API logs and confirm that the production
schema contains both tables.
