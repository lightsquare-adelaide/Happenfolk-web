import { expect, test } from "vitest";
import pg from "pg";
import { admin, createUser, stackConfig } from "../access/_harness";
import { createPricedEvent } from "./_fixtures";

test("the retired global switch cannot change a per-call settlement", async () => {
  const host = await createUser("isolation-host");
  const member = await createUser("isolation-member");
  const event = await createPricedEvent(host, "Isolated outcome", 1000);
  const registration = await member.client.rpc("register_for_event", { p_event_id: event });
  expect(registration.error).toBeNull();
  const order = await member.client.from("orders").select("id").eq("registration_id", registration.data).single();
  expect(order.error).toBeNull();
  const a = await admin();
  try {
    await a.query("update public.payment_stub_settings set force_fail = true where id");
    const settled = await member.client.rpc("settle_order", { p_order_id: order.data?.id, p_force_fail: false });
    expect(settled.error).toBeNull();
    expect(settled.data).toBe("succeeded");
    const signatures = await a.query("select to_regprocedure('public.settle_order(uuid)') as old_signature");
    expect(signatures.rows[0].old_signature).toBeNull();
  } finally {
    await a.query("update public.payment_stub_settings set force_fail = false where id");
  }
});

test("concurrent opposite outcomes on one order preserve the first committed settlement", async () => {
  const host = await createUser("same-order-host");
  const member = await createUser("same-order-member");
  const event = await createPricedEvent(host, "Same order race", 1000);
  const registration = await member.client.rpc("register_for_event", { p_event_id: event });
  expect(registration.error).toBeNull();
  const order = await member.client.from("orders").select("id").eq("registration_id", registration.data).single();
  expect(order.error).toBeNull();
  const connections = [new pg.Client({ connectionString: stackConfig().dbUrl }), new pg.Client({ connectionString: stackConfig().dbUrl })];
  const [a, b] = connections;
  try {
    for (const connection of connections) {
      await connection.connect();
      await connection.query("begin");
      await connection.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: member.userId, role: "authenticated" })]);
      await connection.query("set local role authenticated");
      await connection.query("set local statement_timeout = '5s'");
    }
    expect((await a.query("select public.settle_order($1, false) as status", [order.data?.id])).rows[0].status).toBe("succeeded");
    const pid = (await b.query("select pg_backend_pid() as pid")).rows[0].pid;
    const waiting = b.query("select public.settle_order($1, true) as status", [order.data?.id]);
    const adminConnection = await admin();
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const activity = await adminConnection.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
      if (activity.rows[0]?.wait_event_type === "Lock") { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await a.query("commit");
    const second = await waiting;
    await b.query("commit");
    expect(blocked).toBe(true);
    expect(second.rows[0].status).toBe("succeeded");
    const state = await member.client.from("orders").select("status").eq("id", order.data?.id).single();
    expect(state.data?.status).toBe("succeeded");
  } finally {
    for (const connection of connections) {
      await connection.query("rollback").catch(() => {});
      await connection.end();
    }
  }
});
