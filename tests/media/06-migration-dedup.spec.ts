import { readFileSync } from "node:fs";
import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
} from "vitest";
import { stackConfig } from "../access/_harness";

const migration = readFileSync(
  "supabase/migrations/20261013000200_media_operations.sql",
  "utf8",
);
const block = migration.match(/do \$\$[\s\S]*?\$\$;/i)?.[0];
if (!block) throw new Error("Duplicate cleanup block not found");

// Run the actual migration logic against a session-local temporary table.
const cleanup = block.replaceAll(
  "public.media_assets",
  "pg_temp.media_assets",
);

let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: stackConfig().dbUrl });
  await db.connect();
});

afterAll(async () => {
  if (db) await db.end();
});

beforeEach(async () => {
  await db.query("BEGIN");
  await db.query(`
    CREATE TEMP TABLE media_assets
      (LIKE public.media_assets INCLUDING DEFAULTS)
      ON COMMIT DROP;

    INSERT INTO pg_temp.media_assets
      (id, portfolio_item_id, path, alt_text, content_type,
       bucket, position, created_at, width, height)
    VALUES
      ('00000000-0000-0000-0000-000000000002',
       '00000000-0000-0000-0000-000000000010',
       'duplicate.jpg', 'Same caption', 'image/jpeg',
       'drafts', 0, '2020-01-01T00:00:00Z', 640, 480),
      ('00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000010',
       'duplicate.jpg', 'Same caption', 'image/jpeg',
       'drafts', 0, '2021-01-01T00:00:00Z', 640, 480);
  `);
});

afterEach(async () => {
  await db.query("ROLLBACK");
});

it("keeps the earliest row when duplicate metadata matches", async () => {
  await db.query(cleanup);

  const result = await db.query(
    "SELECT id FROM pg_temp.media_assets",
  );
  expect(result.rows).toEqual([
    { id: "00000000-0000-0000-0000-000000000002" },
  ]);
});

it.each([
  { column: "alt_text", value: "Different caption" },
  { column: "content_type", value: "image/png" },
  { column: "width", value: 800 },
  { column: "height", value: 600 },
  { column: "position", value: 1 },
])("preserves duplicates when $column differs", async ({ column, value }) => {
  // Column names come only from the fixed cases above.
  await db.query(
    `UPDATE pg_temp.media_assets SET ${column} = $1
     WHERE id = '00000000-0000-0000-0000-000000000001'`,
    [value],
  );
  await db.query("SAVEPOINT before_cleanup");

  await expect(db.query(cleanup)).rejects.toMatchObject({
    code: "P0001",
    message: "Duplicate media assets have conflicting metadata",
  });

  await db.query("ROLLBACK TO SAVEPOINT before_cleanup");

  const result = await db.query(
    "SELECT count(*)::integer AS count FROM pg_temp.media_assets",
  );
  expect(result.rows[0].count).toBe(2);
});