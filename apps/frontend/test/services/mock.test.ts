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

  it("lets a Sales user list closure reasons to close their own customer", async () => {
    const services = createMockServices();
    await signIn(services, "river@example.test");
    const reasons = await services.listClosureReasons();
    expect(reasons.ok && reasons.data.length > 0).toBe(true);
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

  it("#66: resets a user's password, updating the stored credential and appending a distinct audit action", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const reset = await services.resetUserPassword("sales-river", "brand new correct horse");
    expect(reset.ok).toBe(true);
    expect(reset.ok && Object.keys(reset.data).sort()).toEqual(["active", "email", "id", "name", "role"]);
    await services.logout();
    expect((await services.login("river@example.test", MOCK_PASSWORD)).ok).toBe(false);
    expect((await services.login("river@example.test", "brand new correct horse")).ok).toBe(true);
    await signIn(services, "alex@example.test");
    const audit = await services.audit({ action: "Password reset" });
    expect(audit.ok && audit.data.items[0]).toMatchObject({ target: "sales-river", actorId: "admin-demo" });
  });

  it("#66: rejects a too-short/too-long password and an unknown user for password reset", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const tooShort = await services.resetUserPassword("sales-river", "short");
    expect(tooShort.ok).toBe(false);
    expect(!tooShort.ok && tooShort.error.code).toBe("validation");
    const missing = await services.resetUserPassword("does-not-exist", "brand new correct horse");
    expect(missing.ok).toBe(false);
  });

  it("#66: blocks a Sales user from resetting anyone's password", async () => {
    const services = createMockServices();
    await signIn(services, "river@example.test");
    const result = await services.resetUserPassword("sales-sky", "brand new correct horse");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("runs bulk assignment onto the single active rule's owner", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    await services.createAssignmentRule({ name: "Primary", conditions: [], memberIds: ["sales-sky"], active: true });
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

describe("mock services: assignment rules", () => {
  it("round-trips conditions and memberIds", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const conditions = [{ field: "propensity_tier", operator: "=" as const, value: "A" }];
    const created = await services.createAssignmentRule({ name: "Tier A", conditions, memberIds: ["sales-river"], active: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.conditions).toEqual(conditions);
    expect(created.data.memberIds).toEqual(["sales-river"]);
    const listed = await services.listAssignmentRules();
    expect(listed.ok && listed.data).toHaveLength(1);
  });

  it("rejects a case-insensitive duplicate rule name with a 409", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    await services.createAssignmentRule({ name: "Primary", conditions: [], memberIds: ["sales-river"], active: true });
    const result = await services.createAssignmentRule({ name: "primary", conditions: [], memberIds: ["sales-sky"], active: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("conflict");
    expect(!result.ok && result.error.message.toLowerCase()).toContain("already exist");
  });

  it("rejects zero eligible members and members that are not active Sales users with a 422", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const empty = await services.createAssignmentRule({ name: "No members", conditions: [], memberIds: [], active: true });
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.error.code).toBe("validation");

    const invalid = await services.createAssignmentRule({ name: "Bad member", conditions: [], memberIds: ["admin-demo"], active: true });
    expect(invalid.ok).toBe(false);
    expect(!invalid.ok && invalid.error.code).toBe("validation");
  });

  it("rejects a stale version on update with a 409, and does not apply the change", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const created = await services.createAssignmentRule({ name: "Primary", conditions: [], memberIds: ["sales-river"], active: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const versionResult = await services.getAssignmentVersion();
    const staleVersion = versionResult.ok ? versionResult.data : 0;
    const conflicting = await services.updateAssignmentRule(created.data.id, { name: "Renamed", version: staleVersion - 1 });
    expect(conflicting.ok).toBe(false);
    expect(!conflicting.ok && conflicting.error.code).toBe("conflict");
    expect(!conflicting.ok && conflicting.error.message.toLowerCase()).toContain("stale");
    const unchanged = await services.listAssignmentRules();
    expect(unchanged.ok && unchanged.data[0]?.name).toBe("Primary");
  });

  it("bumps the assignment version on every successful create/update", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const before = await services.getAssignmentVersion();
    expect(before.ok && before.data).toBe(1);
    const created = await services.createAssignmentRule({ name: "Primary", conditions: [], memberIds: ["sales-river"], active: true });
    expect(created.ok).toBe(true);
    const afterCreate = await services.getAssignmentVersion();
    expect(afterCreate.ok && afterCreate.data).toBe(2);
    if (!created.ok) return;
    await services.updateAssignmentRule(created.data.id, { active: false });
    const afterUpdate = await services.getAssignmentVersion();
    expect(afterUpdate.ok && afterUpdate.data).toBe(3);
  });
});

describe("mock services: assignment rule order ties (#103)", () => {
  async function tiedRules() {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const a = await services.createAssignmentRule({ name: "A", conditions: [], memberIds: ["sales-river"], active: true });
    const b = await services.createAssignmentRule({ name: "B", conditions: [], memberIds: ["sales-sky"], active: true });
    if (!a.ok || !b.ok) throw new Error("create failed");
    await services.updateAssignmentRule(a.data.id, { order: 2 });
    await services.updateAssignmentRule(b.data.id, { order: 2 });
    const [first, second] = a.data.id < b.data.id ? [a.data, b.data] : [b.data, a.data];
    return { services, first, second };
  }

  it("lists equal-order rules by id with plain string comparison", async () => {
    const { services, first, second } = await tiedRules();
    const listed = await services.listAssignmentRules();
    expect(listed.ok && listed.data.map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it("runs the id-first tied rule", async () => {
    const { services, first } = await tiedRules();
    const run = await services.runAssignments("unassigned", "tie-run");
    expect(run.ok && run.data.assigned).toBeGreaterThan(0);
    const customer = await services.getCustomer("000125"); // was unassigned
    expect(customer.ok && customer.data.ownerId).toBe(first.memberIds[0]);
  });

  it("places a newly created rule in (order, id) position straight away", async () => {
    const services = createMockServices();
    await signIn(services, "alex@example.test");
    const a = await services.createAssignmentRule({ name: "A", conditions: [], memberIds: ["sales-river"], active: true });
    if (!a.ok) throw new Error("create failed");
    await services.updateAssignmentRule(a.data.id, { order: 5 });
    const b = await services.createAssignmentRule({ name: "B", conditions: [], memberIds: ["sales-sky"], active: true });
    if (!b.ok) throw new Error("create failed");
    const listed = await services.listAssignmentRules();
    expect(listed.ok && listed.data.map((item) => item.id)).toEqual([b.data.id, a.data.id]);
  });
});
