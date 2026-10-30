import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  applyRedGuard,
  countOccupying,
  loadFixtures,
  resetCapacityEvent,
  restoreFunctionGrants,
} from "./_harness";

/**
 * BUILD_PLAN P7 acceptance: capacity 2, five concurrent registrants,
 * exactly 2 succeed. Run TWENTY rounds — without the 0021 row lock a
 * single lucky round proves nothing (the reverse verification
 * PAYMENTS_RED=lock must turn this file red).
 */

let restore: (() => Promise<void>) | null = null;

beforeAll(async () => {
  restore = await applyRedGuard();
});

afterAll(async () => {
  if (restore) await restore();
  await restoreFunctionGrants();
});

describe("P7 — concurrency: capacity 2, five racers, twenty rounds", () => {
  it("admits exactly 2 in every round", async () => {
    const { members, capacityEventId } = await loadFixtures();
    const a = await admin();

    for (let round = 1; round <= 20; round += 1) {
      await resetCapacityEvent(a, capacityEventId);

      const results = await Promise.allSettled(
        members.map((m) =>
          m.client.rpc("register_for_event", { p_event_id: capacityEventId }),
        ),
      );
      const admitted = results.filter(
        (r) => r.status === "fulfilled" && r.value.error === null,
      ).length;
      const rejected = results.filter(
        (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error !== null),
      ).length;

      expect(admitted).toBe(2);
      expect(rejected).toBe(3);
      expect(await countOccupying(a, capacityEventId)).toBe(2);
    }
  });
});
