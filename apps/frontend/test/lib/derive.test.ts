import { describe, expect, it } from "vitest";
import { bucketOf, openFollowUp } from "@/lib/derive";
import type { Customer } from "@/lib/types";
import type { FollowUp } from "@/lib/types";

// #118: dashboard buckets ("Overdue follow-ups", "Follow-ups due today", "Follow-ups without
// date") are derived entirely by bucketOf from the open follow-up on a customer. This proves
// that bucketing itself is correct so the only remaining risk is the API actually delivering
// followUps on the list endpoint (covered in apps/api/test/test_customers.py).
const customer = (bcn = "000123") => ({ bcn }) as unknown as Customer;

const followUp = (overrides: Partial<FollowUp> = {}): FollowUp => ({
  id: "fu-1",
  bcn: "000123",
  type: "reminder",
  dueAt: null,
  userId: "sales-1",
  ...overrides,
});

describe("bucketOf", () => {
  it("buckets a past-dated open follow-up as overdue", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(bucketOf(customer(), [followUp({ dueAt: yesterday })], true)).toBe("overdue");
  });

  it("buckets a today-dated open follow-up as today", () => {
    const now = new Date().toISOString();
    expect(bucketOf(customer(), [followUp({ dueAt: now })], true)).toBe("today");
  });

  it("buckets an undated open follow-up as undated", () => {
    expect(bucketOf(customer(), [followUp({ dueAt: null })], true)).toBe("undated");
  });

  it("falls through to never when there's no open follow-up and no activity", () => {
    expect(bucketOf(customer(), [], false)).toBe("never");
  });

  it("falls through to other when there's no open follow-up but there is activity", () => {
    expect(bucketOf(customer(), [], true)).toBe("other");
  });

  it("ignores a completed follow-up (openFollowUp filters it out)", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const followUps = [followUp({ dueAt: yesterday, completedAt: new Date().toISOString() })];
    expect(openFollowUp(followUps, "000123")).toBeUndefined();
    expect(bucketOf(customer(), followUps, true)).toBe("other");
  });

  it("only looks at the follow-up belonging to this customer", () => {
    const followUps = [followUp({ bcn: "other-bcn", dueAt: new Date(Date.now() - 86400000).toISOString() })];
    expect(bucketOf(customer("000123"), followUps, true)).toBe("other");
  });
});
