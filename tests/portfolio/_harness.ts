import pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Portfolio-suite fixtures. The auth/user/admin machinery is the shared
 * access harness (per-user Supabase clients through RLS, admin pg only
 * for fixtures and red-guard flips — never for assertions of what a
 * user may do). Denials are asserted by DATA STATE, not status codes.
 */
export {
  admin,
  anonClient,
  applyRedGuard,
  createUser,
  guard,
  stackConfig,
  type TestUser,
} from "../access/_harness";

import { stackConfig, type TestUser } from "../access/_harness";

export type OrderRow = { id: string; position: number; created_at: string };

/** The deterministic owner order every read path must use. */
export async function listOwnerOrder(client: SupabaseClient, ownerId: string): Promise<OrderRow[]> {
  const { data, error } = await client
    .from("portfolio_items")
    .select("id, position, created_at")
    .eq("profile_id", ownerId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`listOwnerOrder failed: ${error.message}`);
  return (data ?? []) as OrderRow[];
}

/** Inserts a draft item the way the #20 pipeline does: no position. */
export async function insertDraftItem(client: SupabaseClient, ownerId: string, title: string): Promise<string> {
  const { data, error } = await client
    .from("portfolio_items")
    .insert({ profile_id: ownerId, title, media_kind: "image" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertDraftItem failed: ${error?.message ?? "no row"}`);
  return data.id as string;
}

export async function moveItem(client: SupabaseClient, itemId: string, direction: "up" | "down") {
  return client.rpc("move_portfolio_item", { p_item_id: itemId, p_direction: direction });
}

const connections: pg.Client[] = [];

/**
 * A pg transaction speaking to RLS as the given user (role
 * authenticated + that user's JWT claims). No service role anywhere.
 */
export async function userConnection(user: TestUser): Promise<pg.Client> {
  const connection = new pg.Client({ connectionString: stackConfig().dbUrl });
  await connection.connect();
  connections.push(connection);
  await connection.query("begin");
  await connection.query("set local role authenticated");
  await connection.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: user.userId, role: "authenticated" }),
  ]);
  return connection;
}

export async function endConnections(): Promise<void> {
  await Promise.all(connections.splice(0).map((c) => c.end().catch(() => {})));
}
