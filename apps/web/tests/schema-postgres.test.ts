import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { getMigrations } from "better-auth/db/migration";
import type { Pool } from "pg";
import { freshDatabase, schema, skipDatabase } from "./postgres";

let pool: Pool;
let drop: () => Promise<void>;

before(async () => {
  if (skipDatabase) return;
  ({ pool, drop } = await freshDatabase("schema"));
});
after(async () => { if (!skipDatabase) await drop(); });

test("schema.sql can be run again safely", { skip: skipDatabase }, async () => {
  await pool.query(schema);
});

test("Better Auth finds every table and column it needs", { skip: skipDatabase }, async () => {
  const options = { database: pool, socialProviders: { google: { clientId: "test", clientSecret: "test" } } };
  const { toBeCreated, toBeAdded } = await getMigrations(options as Parameters<typeof getMigrations>[0]);
  assert.deepEqual(toBeCreated.map((table) => table.table), []);
  assert.deepEqual(toBeAdded.map((table) => table.table), []);
});
