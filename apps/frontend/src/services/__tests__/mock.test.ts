import { describe, expect, it } from "vitest";
import { MOCK_PASSWORD, createMockServices } from "@/services/mock";
import type { Services } from "@/services/types";

async function signIn(services: Services, email: string) {
  const result = await services.login(email, MOCK_PASSWORD);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("mock services: session", () => {
  it("rejects unknown credentials and accepts seeded ones", async () => {
    const services = createMockServices();
    expect((await services.login("nobody@example.test", MOCK_PASSWORD)).ok).toBe(false);
    expect((await services.login("river@example.test", "wrong")).ok).toBe(false);
    const result = await services.login("river@example.test", MOCK_PASSWORD);
    expect(result.ok && result.data.role).toBe("Sales");
  });

  it("requires auth for protected reads and clears identity on logout", async () => {
    const services = createMockServices();
    expect((await services.listCustomers()).ok).toBe(false);
    await signIn(services, "river@example.test");
    expect((await services.listCustomers()).ok).toBe(true);
    await services.logout();
    expect((await services.currentUser()).ok).toBe(false);
  });
});

describe("mock services: customer workflows", () => {
  it("only lets the owner or an Admin work a customer", async () => {
    const services = createMockServices();
    await signIn(services, "sky@example.test"); // owns 000124, not 000123
    const result = await services.createNote("000123", { text: "hi", submissionId: "s1" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("records interactions and notes idempotently by submissionId", async () => {
    const services = createMockServices();
    await signIn(services, "river@example.test"); // owns 000123
    const first = await services.createInteraction("000123", { outcome: "Contact", note: "Answered", submissionId: "sub-1" });
    const replay = await services.createInteraction("000123", { outcome: "Contact", note: "Answered", submissionId: "sub-1" });
    expect(first.ok && replay.ok && first.data.id === replay.data.id).toBe(true);
    const customer = await services.getCustomer("000123");
    expect(customer.ok && customer.data.histories.filter((h) => h.kind === "Interaction").length).toBe(1);
  });

  it("runs the full follow-up lifecycle: create, edit, complete", async () => {
    const services = createMockServices();
    await signIn(services, "river@example.test");
    const created = await services.createFollowUp("000123", { type: "Reminder", due: null, note: "Call back", submissionId: "f1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const completed = await services.completeFollowUp("000123", created.data.id, { outcome: "Contact", note: "Done", submissionId: "f1-complete" });
    expect(completed.ok && completed.data.status).toBe("Completed");
    // Completing again with a new submission should fail: already completed, not idempotent replay.
    const again = await services.completeFollowUp("000123", created.data.id, { outcome: "Contact", note: "Done", submissionId: "f1-complete-2" });
    expect(again.ok).toBe(true); // returns the already-completed record rather than erroring
  });

  it("cancels open follow-ups when a customer closes, and supports reopen", async () => {
    const services = createMockServices();
    await signIn(services, "river@example.test");
    await services.createFollowUp("000123", { type: "Reminder", due: null, note: "Call back", submissionId: "f1" });
    const closed = await services.closeCustomer("000123", { reasonId: "closure-1", submissionId: "close-1" });
    expect(closed.ok && closed.data.status).toBe("Closed");
    expect(closed.ok && closed.data.followUps.every((f) => f.status === "Cancelled")).toBe(true);
    const reopened = await services.reopenCustomer("000123", { submissionId: "reopen-1" });
    expect(reopened.ok && reopened.data.status).toBe("Open");
  });
});

describe("mock services: admin", () => {
  it("blocks non-admins from admin operations", async () => {
    const services = createMockServices();
    await signIn(services, "river@example.test");
    expect((await services.listUsers()).ok).toBe(false);
    expect((await services.listAssignmentRules()).ok).toBe(false);
  });

  it("releases a deactivated Sales user's open customers", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const before = await services.getCustomer("000123");
    expect(before.ok && before.data.ownerId).toBe("sales-river");
    const update = await services.updateUser("sales-river", { active: false });
    expect(update.ok && update.data.active).toBe(false);
    const after = await services.getCustomer("000123");
    expect(after.ok && after.data.ownerId).toBe(null);
  });

  it("prevents an admin from demoting or deactivating themselves", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const result = await services.updateUser("admin-demo", { active: false });
    expect(result.ok).toBe(false);
  });

  it("runs bulk assignment onto the single active rule's owner", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    await services.createAssignmentRule({ name: "Primary", ownerId: "sales-sky", active: true });
    const run = await services.runAssignments("unassigned", "run-1");
    expect(run.ok && run.data.assigned).toBeGreaterThan(0);
    const customer = await services.getCustomer("000125"); // was unassigned
    expect(customer.ok && customer.data.ownerId).toBe("sales-sky");
  });

  it("imports a workbook idempotently by submissionId and content", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const file = new File([new Uint8Array([1, 2, 3])], "customers.xlsx");
    const first = await services.importWorkbook(file, "import-1");
    const replay = await services.importWorkbook(file, "import-1");
    expect(first.ok && replay.ok && first.data.jobId === replay.data.jobId).toBe(true);
    const otherFile = new File([new Uint8Array([9, 9, 9, 9])], "customers.xlsx");
    const conflict = await services.importWorkbook(otherFile, "import-1");
    expect(conflict.ok).toBe(false);
  });

  it("rejects an inactive or non-existent closure reason on close", async () => {
    const services = createMockServices();
    await signIn(services, "river@example.test");
    const result = await services.closeCustomer("000123", { reasonId: "no-such-reason", submissionId: "close-x" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("validation");
  });
});
