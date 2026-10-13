#!/usr/bin/env node
/**
 * CI invariant assertions for the Lightsquare data layer (P0/P1).
 *
 * Exits 0 only if ALL three hold against the LOCAL database:
 *   1. Every table in `public` has Row-Level Security enabled
 *      (pg_tables.rowsecurity = true). A table with policies but no RLS
 *      is wide open to anyone holding the anon key.
 *   2. Every table that has a `search_vector` column also has a trigger
 *      whose definition maintains that column. A column + GIN index with
 *      no trigger stays NULL forever and full-text search silently
 *      returns nothing.
 *   3. All four discovery objects exist (as views or materialized views):
 *      trending_events, trending_artists, recommended_events,
 *      recommended_artists. The gate ARMS ITSELF the moment the first
 *      file appears in supabase/migrations: pre-P1 it reports disarmed;
 *      after that 4/4 is mandatory, so a regression that drops one of
 *      the four fails the build.
 *
 * Connection: SUPABASE_DB_URL / DATABASE_URL, defaulting to the local
 * `supabase start` database. Never point this at production.
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const CONNECTION_STRING =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const REQUIRED_OBJECTS = [
  'trending_events',
  'trending_artists',
  'recommended_events',
  'recommended_artists',
];

let failures = 0;

function pass(label, detail) {
  console.log(`✅ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  failures += 1;
  console.log(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function checkRowLevelSecurity(client) {
  const { rows } = await client.query(
    `select tablename from pg_tables
     where schemaname = 'public' and rowsecurity = false
     order by tablename`,
  );
  if (rows.length === 0) {
    const { rows: all } = await client.query(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );
    pass('invariant 1: RLS enabled on every public table', `${all[0].n} table(s) checked`);
  } else {
    fail(
      'invariant 1: RLS enabled on every public table',
      `RLS off on: ${rows.map((r) => r.tablename).join(', ')}`,
    );
  }
}

async function checkSearchVectorTriggers(client) {
  const { rows: tables } = await client.query(
    `select distinct table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'search_vector'
     order by table_name`,
  );
  if (tables.length === 0) {
    pass('invariant 2: search_vector triggers', 'no search_vector columns yet');
    return;
  }
  const missing = [];
  for (const { table_name } of tables) {
    const { rows } = await client.query(
      `select 1 from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = $1
         and not t.tgisinternal
         and pg_get_triggerdef(t.oid) ilike '%search_vector%'`,
      [table_name],
    );
    if (rows.length === 0) missing.push(table_name);
  }
  if (missing.length === 0) {
    pass(
      'invariant 2: search_vector triggers',
      `${tables.map((t) => t.table_name).join(', ')}`,
    );
  } else {
    fail(
      'invariant 2: search_vector triggers',
      `no maintaining trigger on: ${missing.join(', ')}`,
    );
  }
}

async function checkDiscoveryObjects(client) {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  const hasMigrations =
    fs.existsSync(migrationsDir) &&
    fs.readdirSync(migrationsDir).some((f) => f.endsWith('.sql'));

  const { rows } = await client.query(
    `select viewname as name from pg_views where schemaname = 'public'
     union
     select matviewname as name from pg_matviews where schemaname = 'public'`,
  );
  const found = new Set(rows.map((r) => r.name));
  const missing = REQUIRED_OBJECTS.filter((name) => !found.has(name));

  if (!hasMigrations) {
    // Pre-data-layer: there is nothing to protect yet. The first
    // migration arms this check; from then on 4/4 is mandatory.
    pass(
      'invariant 3: trending/recommended objects (events + artists)',
      `disarmed pre-P1 — ${REQUIRED_OBJECTS.length - missing.length}/4 present, no migrations yet`,
    );
    return;
  }

  if (missing.length === 0) {
    pass('invariant 3: trending/recommended objects (events + artists)', '4/4 present');
  } else {
    fail(
      'invariant 3: trending/recommended objects (events + artists)',
      `missing: ${missing.join(', ')}`,
    );
  }
}

async function main() {
  console.log(`check-invariants: connecting to ${CONNECTION_STRING.replace(/:[^:@/]*@/, ':***@')}`);
  const client = new Client({ connectionString: CONNECTION_STRING });
  try {
    await client.connect();
  } catch (err) {
    console.log(`❌ cannot connect to local database: ${err.message}`);
    console.log('   Is the local Supabase stack up? Run `supabase start` first.');
    process.exit(2);
  }
  try {
    await checkRowLevelSecurity(client);
    await checkSearchVectorTriggers(client);
    await checkDiscoveryObjects(client);
  } finally {
    await client.end();
  }
  if (failures > 0) {
    console.log(`\ncheck-invariants: ${failures} invariant(s) FAILED`);
    process.exit(1);
  }
  console.log('\ncheck-invariants: all invariants hold');
}

await main();
