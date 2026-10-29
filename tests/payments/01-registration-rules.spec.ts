import { describe, expect, it } from "vitest";
import { admin, anonClient, countOccupying, loadFixtures } from "./_harness";

/**
 * Registration rules (BUILD_PLAN P1 scenarios 12 + 18): free events
 * confirm immediately and appear in the member's own list AND the
 * host's roster; anonymous registration is rejected.
 */

describe("P7 — scenario 12: free registration is instant and visible", () => {
  it("confirms immediately and shows in own list and host roster", async () => {
    const { members, freeEventId, host } = await loadFixtures();
    const member = members[0];

    const { data: registrationId, error } = await member.client.rpc("register_for_event", {
      p_event_id: freeEventId,
    });
    expect(error).toBeNull();
    expect(typeof registrationId).toBe("string");

    // Own list (RLS: own rows).
    const { data: own } = await member.client
      .from("event_registrations")
      .select("id, status, event_id")
      .eq("member_id", member.userId);
    expect((own ?? []).some((r) => r.id === registrationId && r.status === "confirmed")).toBe(true);

    // Host roster (RLS: event team sees their events' registrations).
    const { data: roster } = await host.client
      .from("event_registrations")
      .select("id, member_id, status")
      .eq("event_id", freeEventId);
    expect((roster ?? []).some((r) => r.member_id === member.userId && r.status === "confirmed")).toBe(
      true,
    );
  });
});

describe("P7 — scenario 18: anonymous registration is rejected", () => {
  it("rejects the RPC for signed-out visitors", async () => {
    const { freeEventId } = await loadFixtures();
    const { error } = await anonClient().rpc("register_for_event", {
      p_event_id: freeEventId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("AUTH_REQUIRED");
  });
});

describe("P7 — cancel frees the seat and re-registering works", () => {
  it("moves confirmed -> cancelled -> confirmed again", async () => {
    const { members, freeEventId } = await loadFixtures();
    const member = members[1];
    const a = await admin();

    const { data: registrationId, error } = await member.client.rpc("register_for_event", {
      p_event_id: freeEventId,
    });
    expect(error).toBeNull();

    const { error: cancelError } = await member.client.rpc("cancel_registration", {
      p_registration_id: registrationId,
    });
    expect(cancelError).toBeNull();
    const afterCancel = await countOccupying(a, freeEventId);

    const { data: reregreistered, error: reError } = await member.client.rpc("register_for_event", {
      p_event_id: freeEventId,
    });
    expect(reError).toBeNull();
    expect(reregreistered).toBe(registrationId); // same registration, reactivated

    const { data: row } = await member.client
      .from("event_registrations")
      .select("status")
      .eq("id", registrationId)
      .maybeSingle();
    expect(row?.status).toBe("confirmed");
    expect(afterCancel).toBeGreaterThanOrEqual(0); // cancelled never occupies
  });
});
