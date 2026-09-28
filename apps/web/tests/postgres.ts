import { readFileSync } from "node:fs";
import { Pool } from "pg";

// Database tests run against a disposable database created from TEST_DATABASE_URL (a local
// Postgres the tests may create and drop databases in). They skip without it, and fail in CI.

export const databaseURL = process.env.TEST_DATABASE_URL;
export const skipDatabase = databaseURL ? false : process.env.CI ? false : "set TEST_DATABASE_URL to run database tests";
export const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

export async function freshDatabase(name: string): Promise<{ pool: Pool; url: string; drop: () => Promise<void> }> {
  if (!databaseURL) throw new Error("TEST_DATABASE_URL is required in CI.");
  const admin = new Pool({ connectionString: databaseURL, max: 1 });
  const database = `stash_test_${name}_${process.pid}`;
  await admin.query(`drop database if exists ${database}`);
  await admin.query(`create database ${database}`);
  const url = new URL(databaseURL);
  url.pathname = `/${database}`;
  const pool = new Pool({ connectionString: url.href, max: 4 });
  // Dropping the database at the end ends any connection still closing; that's expected here.
  pool.on("error", () => {});
  // Supabase's API roles, so the tests see the same grants a real project has.
  await pool.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$`);
  await pool.query("grant usage on schema public to anon, authenticated");
  await pool.query("alter default privileges in schema public grant all on tables to anon, authenticated");
  await pool.query(schema);
  return {
    pool, url: url.href,
    drop: async () => {
      await pool.end();
      await admin.query(`drop database if exists ${database} with (force)`);
      await admin.end();
    },
  };
}

export async function createUser(pool: Pool, id: string) {
  await pool.query(`insert into public."user" (id, name, email, "emailVerified") values ($1, $1, $1 || '@example.com', true)`, [id]);
}
