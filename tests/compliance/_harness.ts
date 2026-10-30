import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { stackConfig } from "../access/_harness";

export {
  anonClient,
  createUser,
  stackConfig,
  type TestUser,
} from "../access/_harness";

/** Local fixture setup only; permission assertions use member/anonymous clients. */
export function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Local compliance fixtures need SUPABASE_SERVICE_ROLE_KEY");
  return createClient(stackConfig().url, key, { auth: { persistSession: false } });
}

export async function withPg<T>(run: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: stackConfig().dbUrl });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}
