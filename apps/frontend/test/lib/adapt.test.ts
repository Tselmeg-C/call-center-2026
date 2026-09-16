import { describe, expect, it } from "vitest";
import {
  fromFollowUpType,
  toActivities,
  toAssignmentEvents,
  toCustomer,
  toFollowUp,
  toFollowUpType,
  toNotes,
  toUser,
} from "@/lib/adapt";
import type { Customer as ServiceCustomer, FollowUp as ServiceFollowUp } from "@/services/types";

function customer(overrides: Partial<ServiceCustomer> = {}): ServiceCustomer {
  return {
    bcn: "000123", name: "Acme", ownerId: "sales-river", ownerName: "River", status: "Open",
    phones: ["555-0100"], version: 0, histories: [], followUps: [],
    source: { propensity_tier: "A", propensity_score: 0.9, revenue_amount_2025: 100 },
    ...overrides,
  };
}

describe("toUser", () => {
  it("lowercases the role for the UI", () => {
    expect(toUser({ id: "1", name: "A", email: "a@example.test", role: "Admin", active: true }).role).toBe("admin");
    expect(toUser({ id: "2", name: "B", email: "b@example.test", role: "Sales", active: true }).role).toBe("sales");
  });
});

describe("toCustomer", () => {
  it("maps source fields and phones", () => {
    const ui = toCustomer(customer());
    expect(ui.propensityTier).toBe("A");
    expect(ui.revenue[2025]).toBe(100);
    expect(ui.phones).toEqual([{ id: "000123-p0", number: "555-0100", primary: true }]);
  });

  it("derives status from the most recent non-deleted interaction", () => {
    const withInteractions = customer({
      histories: [
        { id: "1", bcn: "000123", kind: "Interaction", outcome: "Attempt", timestamp: "2026-01-01T00:00:00Z" },
        { id: "2", bcn: "000123", kind: "Interaction", outcome: "Contact", timestamp: "2026-01-02T00:00:00Z" },
      ],
    });
    expect(toCustomer(withInteractions).status).toBe("contacted");
  });

  it("reports closed status and the most recent closure reason regardless of status field drift", () => {
    const closed = customer({
      status: "Closed",
      histories: [{ id: "1", bcn: "000123", kind: "Closure", reason: "Won", timestamp: "2026-01-01T00:00:00Z" }],
    });
    const ui = toCustomer(closed);
    expect(ui.status).toBe("closed");
    expect(ui.closureReason).toBe("Won");
  });
});

describe("history projections", () => {
  it("filters activities and notes by kind and excludes deleted rows", () => {
    const withHistory = customer({
      histories: [
        { id: "1", bcn: "000123", kind: "Interaction", outcome: "Contact", timestamp: "2026-01-01T00:00:00Z", actorId: "u1" },
        { id: "2", bcn: "000123", kind: "Interaction", outcome: "Attempt", timestamp: "2026-01-02T00:00:00Z", deleted: true },
        { id: "3", bcn: "000123", kind: "Standalone note", text: "hello", timestamp: "2026-01-03T00:00:00Z" },
      ],
    });
    expect(toActivities(withHistory)).toHaveLength(1);
    expect(toNotes(withHistory)[0]?.body).toBe("hello");
  });

  it("synthesizes a stable id for history rows the backend doesn't give one (e.g. Assignment)", () => {
    const withAssignment = customer({
      histories: [{ bcn: "000123", kind: "Assignment", oldOwner: null, newOwner: "sales-river", timestamp: "2026-01-01T00:00:00Z" } as never],
    });
    const events = toAssignmentEvents(withAssignment);
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBeTruthy();
    expect(events[0]?.toUserId).toBe("sales-river");
  });
});

describe("follow-up type round-trip", () => {
  it("maps UI 'needed' to a dateless Reminder and back", () => {
    expect(fromFollowUpType("needed")).toBe("Reminder");
    expect(toFollowUpType("Reminder", null)).toBe("needed");
    expect(toFollowUpType("Reminder", "2026-01-01")).toBe("reminder");
    expect(toFollowUpType("Appointment", "2026-01-01")).toBe("appointment");
  });

  it("marks a completed follow-up with a completedAt timestamp", () => {
    const followUp: ServiceFollowUp = { id: "f1", bcn: "000123", type: "Reminder", due: null, note: "n", status: "Completed", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" };
    expect(toFollowUp(followUp).completedAt).toBe("2026-01-02T00:00:00Z");
  });
});
