import { describe, expect, it } from "vitest";
import { swapRuleOrder } from "@/lib/store";
import type { AssignmentRule, AssignmentRulePatch, Result } from "@/services/types";

const rule = (id: string, order: number): AssignmentRule => ({ id, name: id, conditions: [], memberIds: ["sales-river"], active: true, order });

// Mimics apps/api/main.py's PATCH /admin/assignment-rules/{id}: compare-and-swap on the shared
// assignment version, +1 on success, 409 "stale" otherwise. `failOn` forces a failure for one rule id.
function fakeServices(initialVersion: number, failOn?: string) {
  let version = initialVersion;
  const rules = [rule("R1", 1), rule("R2", 2), rule("R3", 3)];
  const calls: { id: string; patch: AssignmentRulePatch }[] = [];
  let inFlight = 0;
  const services = {
    async updateAssignmentRule(id: string, patch: AssignmentRulePatch): Promise<Result<AssignmentRule>> {
      calls.push({ id, patch });
      inFlight += 1;
      if (inFlight > 1) throw new Error("PATCHes must not run concurrently");
      await Promise.resolve();
      inFlight -= 1;
      if (id === failOn) return { ok: false, error: { code: "request-failure", message: "boom" } };
      if (patch.version !== version) return { ok: false, error: { code: "conflict", message: "Assignment configuration is stale." } };
      const target = rules.find((item) => item.id === id)!;
      target.order = patch.order!;
      version += 1;
      return { ok: true, data: { ...target } };
    },
    async listAssignmentRules(): Promise<Result<AssignmentRule[]>> {
      return { ok: true, data: rules.map((item) => ({ ...item })) };
    },
    async getAssignmentVersion(): Promise<Result<number>> {
      return { ok: true, data: version };
    },
  };
  return { services, calls, rules };
}

describe("swapRuleOrder", () => {
  it("sends the two order PATCHes sequentially, each with the version the previous one produced", async () => {
    const { services, calls } = fakeServices(5);
    const outcome = await swapRuleOrder(services, rule("R1", 1), rule("R2", 2), 5, "down");
    expect(calls).toEqual([
      { id: "R1", patch: { order: 2, version: 5 } },
      { id: "R2", patch: { order: 1, version: 6 } },
    ]);
    expect(outcome).toEqual({ ok: true, updated: [rule("R1", 2), rule("R2", 1)], version: 7 });
  });

  it("on a half-applied swap, stops and resyncs rules and version from the server", async () => {
    const { services, calls } = fakeServices(5, "R2");
    const outcome = await swapRuleOrder(services, rule("R1", 1), rule("R2", 2), 5, "down");
    expect(calls).toHaveLength(2);
    expect(outcome).toEqual({
      ok: false,
      message: "boom",
      rules: [rule("R1", 2), rule("R2", 2), rule("R3", 3)],
      version: 6,
    });
  });

  it("on a stale first PATCH, sends nothing else and resyncs", async () => {
    const { services, calls } = fakeServices(9);
    const outcome = await swapRuleOrder(services, rule("R1", 1), rule("R2", 2), 5, "down");
    expect(calls).toHaveLength(1);
    expect(outcome).toMatchObject({ ok: false, message: "Assignment configuration is stale.", version: 9 });
  });

  // #116: two rules tied at the same `order` (deterministic only via #103's id tie-break) used to
  // have their equal values written straight back to each other -- a no-op that made Move up/down
  // look broken. A tied swap must now change their relative order instead.
  it("on a tied order, moving down bumps the mover past its neighbor instead of writing the same order back", async () => {
    const { services, calls } = fakeServices(5);
    const outcome = await swapRuleOrder(services, rule("R1", 1), rule("R2", 1), 5, "down");
    expect(calls).toEqual([
      { id: "R1", patch: { order: 2, version: 5 } },
      { id: "R2", patch: { order: 1, version: 6 } },
    ]);
    expect(outcome).toEqual({ ok: true, updated: [rule("R1", 2), rule("R2", 1)], version: 7 });
  });

  it("on a tied order, moving up bumps the neighbor past the mover instead of writing the same order back", async () => {
    const { services, calls } = fakeServices(5);
    const outcome = await swapRuleOrder(services, rule("R1", 1), rule("R2", 1), 5, "up");
    expect(calls).toEqual([
      { id: "R1", patch: { order: 1, version: 5 } },
      { id: "R2", patch: { order: 2, version: 6 } },
    ]);
    expect(outcome).toEqual({ ok: true, updated: [rule("R1", 1), rule("R2", 2)], version: 7 });
  });
});
