import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServices } from "@/services/http";
import type { Services } from "@/services/types";
import { newActorFetch, startBackend, type TestBackend } from "./backend";

// Real-HTTP Sales journey: real network calls against a live FastAPI process
// (CALL_CENTER_STORAGE=memory). Coverage mirrors the retired issue #21 Sales journey:
// interactions/notes, follow-ups (create/edit/cancel/complete), closure/reopen, workload, and
// rejecting unauthorized direct requests (another owner's customer, admin-only routes).
describe("real-HTTP Sales journey", () => {
  let backend: TestBackend;
  let sales: Services;
  let reasonId: string;
  const bcn = "000123"; // seeded memory-mode fixture, initially owned by nobody until assigned below

  beforeAll(async () => {
    backend = await startBackend();
    const admin = createHttpServices({ baseUrl: backend.baseUrl, origin: backend.origin, fetch: newActorFetch() });
    const provisioned = await fetch(`${backend.baseUrl}/operator/provision`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: backend.origin, "x-operator-secret": backend.operatorSecret },
      body: JSON.stringify({ name: "Alex Admin", email: "alex@example.test", role: "Admin", password: "synthetic-only-admin" }),
    });
    expect(provisioned.status).toBe(200);
    expect((await admin.login("alex@example.test", "synthetic-only-admin")).ok).toBe(true);

    const salesUser = await admin.createUser({ name: "River Sales", email: "river@example.test", role: "Sales", password: "synthetic-only-sales" });
    expect(salesUser.ok).toBe(true);
    if (!salesUser.ok) return;
    const assigned = await admin.assignCustomer(bcn, salesUser.data.id, "journey-assign");
    expect(assigned.ok).toBe(true);
    // Memory-mode seeds "Won" already (see apps/api/main.py's MemoryRepo.reset); reuse it rather
    // than colliding with the seed by creating a duplicate label.
    const reasons = await admin.listClosureReasons();
    expect(reasons.ok).toBe(true);
    if (reasons.ok) reasonId = reasons.data.find((item) => item.label === "Won")!.id;

    sales = createHttpServices({ baseUrl: backend.baseUrl, origin: backend.origin, fetch: newActorFetch() });
    expect((await sales.login("river@example.test", "synthetic-only-sales")).ok).toBe(true);
  }, 20_000);

  afterAll(async () => {
    await backend.stop();
  });

  it("browses assigned customers and sees the workload snapshot", async () => {
    const mine = await sales.listCustomers({ mine: true });
    expect(mine.ok && mine.data.items.some((c) => c.bcn === bcn)).toBe(true);
    const workload = await sales.workload();
    expect(workload.ok).toBe(true);
  });

  it("rejects direct requests against a customer this Sales user does not own", async () => {
    const result = await sales.createNote("000125", { text: "not mine", submissionId: "sub-forbidden" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("rejects a Sales session hitting an Admin-only route directly", async () => {
    const result = await sales.listUsers();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("records an interaction and a note", async () => {
    const interaction = await sales.createInteraction(bcn, { outcome: "Attempt", note: "No answer", submissionId: "sub-1" });
    expect(interaction.ok).toBe(true);
    const note = await sales.createNote(bcn, { text: "Prefers afternoons", submissionId: "sub-2" });
    expect(note.ok).toBe(true);
    const detail = await sales.getCustomer(bcn);
    expect(detail.ok && detail.data.histories.some((h) => h.kind === "Interaction")).toBe(true);
    expect(detail.ok && detail.data.histories.some((h) => h.kind === "Standalone note")).toBe(true);
  });

  it("schedules, edits, cancels and completes follow-ups", async () => {
    const created = await sales.createFollowUp(bcn, { type: "Reminder", due: null, note: "Call back", submissionId: "sub-3" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = await sales.updateFollowUp(bcn, created.data.id, { type: "Reminder", due: null, note: "Call back tomorrow", submissionId: "sub-4" });
    expect(edited.ok && edited.data.note).toBe("Call back tomorrow");

    const cancellable = await sales.createFollowUp(bcn, { type: "Reminder", due: null, note: "Second one", submissionId: "sub-5" });
    expect(cancellable.ok).toBe(true);
    if (cancellable.ok) {
      const cancelled = await sales.cancelFollowUp(bcn, cancellable.data.id, "sub-6");
      expect(cancelled.ok && cancelled.data.status).toBe("Cancelled");
    }

    const completed = await sales.completeFollowUp(bcn, created.data.id, { outcome: "Contact", note: "Reached them", submissionId: "sub-7" });
    expect(completed.ok && completed.data.status).toBe("Completed");
  });

  it("closes and reopens the customer", async () => {
    const closed = await sales.closeCustomer(bcn, { reasonId, submissionId: "sub-close" });
    expect(closed.ok && closed.data.status).toBe("Closed");

    const blockedWhileClosed = await sales.createNote(bcn, { text: "should fail", submissionId: "sub-blocked" });
    expect(blockedWhileClosed.ok).toBe(false);
    expect(!blockedWhileClosed.ok && blockedWhileClosed.error.code).toBe("conflict");

    const reopened = await sales.reopenCustomer(bcn, { submissionId: "sub-reopen" });
    expect(reopened.ok && reopened.data.status).toBe("Open");
  });
});
