import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { circuitStudioV2Drafts } from "../src/schema/circuitStudioV2Draft.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  "../migrations/0001_circuit_studio_v2_drafts.sql",
);
const migration = await readFile(migrationPath, "utf8");
const table = getTableConfig(circuitStudioV2Drafts);
const createTableMatch = migration.match(
  /CREATE TABLE IF NOT EXISTS "circuit_studio_v2_drafts" \(([\s\S]*?)\n\);/i,
);

assert.ok(createTableMatch, "The V2 create-table statement must be present.");

const createTableBody = createTableMatch[1];
const migrationColumns = new Map(
  [...createTableBody.matchAll(
    /^\s*"([^"]+)"\s+([a-z]+(?:\s+with\s+time\s+zone)?)(.*?)(?:,)?$/gim,
  )].map(([, name, rawType, rest]) => [
    name,
    {
      type: rawType.toLowerCase().replace(/\s+/g, " "),
      notNull: /\bNOT NULL\b/i.test(rest),
      defaultValue: rest.match(/\bDEFAULT\s+([^,\s]+)/i)?.[1],
    },
  ]),
);

test("V2 table SQL matches Drizzle columns, PostgreSQL types, and nullability", () => {
  assert.equal(migrationColumns.size, table.columns.length);
  for (const column of table.columns) {
    const sqlColumn = migrationColumns.get(column.name);
    assert.ok(sqlColumn, `Missing SQL column ${column.name}`);
    const sqlType =
      sqlColumn.type === "timestamptz"
        ? "timestamp with time zone"
        : sqlColumn.type;
    assert.equal(sqlType, column.getSQLType(), `${column.name} type`);
    assert.equal(sqlColumn.notNull, column.notNull, `${column.name} nullability`);

    if (column.default !== undefined) {
      assert.equal(
        sqlColumn.defaultValue,
        String(column.default),
        `${column.name} default`,
      );
    }
  }
});

test("V2 SQL and Drizzle preserve the composite user/session ownership key", () => {
  const primaryKeys = table.primaryKeys.map((key) =>
    key.columns.map((column) => column.name),
  );
  assert.deepEqual(primaryKeys, [["user_id", "session_id"]]);
  assert.match(
    createTableBody,
    /CONSTRAINT\s+"circuit_studio_v2_drafts_user_session_pk"\s+PRIMARY KEY\s*\("user_id",\s*"session_id"\)/i,
  );
});

test("V2 SQL is repeatable and adds revision to an older V2 table", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS/i);
  assert.match(
    migration,
    /ALTER TABLE IF EXISTS "circuit_studio_v2_drafts"\s+ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1/i,
  );
  assert.equal(migration.match(/ADD COLUMN IF NOT EXISTS "revision"/gi)?.length, 1);
});

test("V2 SQL does not modify legacy history or destructively rewrite data", () => {
  assert.doesNotMatch(migration, /circuit_studio_history/i);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|RENAME|DELETE FROM|UPDATE)\b/i);
});
