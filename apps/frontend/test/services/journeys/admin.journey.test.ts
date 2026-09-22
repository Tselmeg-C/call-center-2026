import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServices } from "@/services/http";
import type { Services } from "@/services/types";
import { newActorFetch, startBackend, type TestBackend } from "./backend";

// Real-HTTP Admin journey: everything here goes over actual network calls (services/http.ts's
// fetch) to a live FastAPI process (CALL_CENTER_STORAGE=memory) started in beforeAll. Coverage
// mirrors the retired issue #21 Admin journey: provision, users, import/reimport, assignment,
// reports, audit, and rejecting unauthorized direct requests.
describe("real-HTTP Admin journey", () => {
  let backend: TestBackend;
  let admin: Services;

  beforeAll(async () => {
    backend = await startBackend();
    admin = createHttpServices({ baseUrl: backend.baseUrl, origin: backend.origin, fetch: newActorFetch() });
    const provisioned = await fetch(`${backend.baseUrl}/operator/provision`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: backend.origin, "x-operator-secret": backend.operatorSecret },
      body: JSON.stringify({ name: "Alex Admin", email: "alex@example.test", role: "Admin", password: "synthetic-only-admin" }),
    });
    expect(provisioned.status).toBe(200);
    const login = await admin.login("alex@example.test", "synthetic-only-admin");
    expect(login.ok).toBe(true);
  }, 20_000);

  afterAll(async () => {
    await backend.stop();
  });

  it("rejects operator provisioning without the operator secret header", async () => {
    const response = await fetch(`${backend.baseUrl}/operator/provision`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: backend.origin },
      body: JSON.stringify({ name: "Mallory", email: "mallory@example.test", role: "Admin", password: "synthetic-only-mallory" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated and unauthorized direct requests", async () => {
    const anonymous = createHttpServices({ baseUrl: backend.baseUrl, origin: backend.origin, fetch: newActorFetch() });
    const anonResult = await anonymous.listUsers();
    expect(anonResult.ok).toBe(false);
    expect(!anonResult.ok && anonResult.error.code).toBe("unauthenticated");

    const sales = createHttpServices({ baseUrl: backend.baseUrl, origin: backend.origin, fetch: newActorFetch() });
    const salesCreated = await admin.createUser({ name: "River Sales", email: "river@example.test", role: "Sales", password: "synthetic-only-sales" });
    expect(salesCreated.ok).toBe(true);
    const salesLogin = await sales.login("river@example.test", "synthetic-only-sales");
    expect(salesLogin.ok).toBe(true);
    const forbidden = await sales.listUsers();
    expect(forbidden.ok).toBe(false);
    expect(!forbidden.ok && forbidden.error.code).toBe("forbidden");
  });

  it("creates a closure reason and a second Sales user for assignment coverage", async () => {
    // Memory-mode seeds "Won" already (see apps/api/main.py's MemoryRepo.reset), so this proves
    // createClosureReason against a genuinely new label instead of colliding with the seed.
    const reason = await admin.createClosureReason("No longer a fit");
    expect(reason.ok).toBe(true);
    const secondSales = await admin.createUser({ name: "Sky Sales", email: "sky@example.test", role: "Sales", password: "synthetic-only-sky" });
    expect(secondSales.ok).toBe(true);
  });

  // #119: the Admin "Add user" form calls this same createUser path; a normalized-email collision
  // must come back as a 409 "conflict" the form can show inline, not a generic failure.
  it("rejects a duplicate normalized email on user creation with a conflict, and leaves the earlier user unaffected", async () => {
    const first = await admin.createUser({ name: "Dup One", email: "dup@example.test", role: "Sales", password: "synthetic-only-dup-one" });
    expect(first.ok).toBe(true);
    const duplicate = await admin.createUser({ name: "Dup Two", email: "DUP@example.test", role: "Sales", password: "synthetic-only-dup-two" });
    expect(duplicate.ok).toBe(false);
    expect(!duplicate.ok && duplicate.error.code).toBe("conflict");
    const users = await admin.listUsers();
    expect(users.ok && users.data.filter((u) => u.email === "dup@example.test")).toHaveLength(1);
  });

  it("imports a workbook, reimports the same submission idempotently, and rejects a changed reupload", async () => {
    const xlsx = await import("./fixtures/customers-workbook");
    const file = xlsx.buildWorkbookFile("customers.xlsx", [{ bcn: "700001", customer_name: "Reef Logistics", phone: "555-0900" }]);
    const first = await admin.importWorkbook(file, "import-journey-1");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.created).toBe(1);
    expect(first.data.errorRows).toBe(0);

    const replay = await admin.importWorkbook(file, "import-journey-1");
    expect(replay.ok && replay.data.jobId).toBe(first.data.jobId);

    const changedFile = xlsx.buildWorkbookFile("customers.xlsx", [{ bcn: "700001", customer_name: "Reef Logistics (renamed)", phone: "555-0900" }]);
    const conflict = await admin.importWorkbook(changedFile, "import-journey-1");
    expect(conflict.ok).toBe(false);
    expect(!conflict.ok && conflict.error.code).toBe("conflict");

    // A genuine reimport (new submission id) updates the existing row rather than duplicating it.
    const reimportFile = xlsx.buildWorkbookFile("customers.xlsx", [{ bcn: "700001", customer_name: "Reef Logistics Inc", phone: "555-0900" }]);
    const reimport = await admin.importWorkbook(reimportFile, "import-journey-2");
    expect(reimport.ok && reimport.data.updated).toBe(1);
    const listed = await admin.listCustomers({ q: "700001" });
    expect(listed.ok && listed.data.items).toHaveLength(1);
    expect(listed.ok && listed.data.items[0]?.name).toBe("Reef Logistics Inc");
  });

  it("assigns customers manually and via a bulk run, then reflects the change in reports and audit", async () => {
    const users = await admin.listUsers();
    expect(users.ok).toBe(true);
    if (!users.ok) return;
    const river = users.data.find((u) => u.email === "river@example.test")!;
    const sky = users.data.find((u) => u.email === "sky@example.test")!;

    const manual = await admin.assignCustomer("700001", river.id, "assign-journey-1");
    expect(manual.ok && manual.data.ownerId).toBe(river.id);

    const rule = await admin.createAssignmentRule({ name: "Everything to Sky", conditions: [], memberIds: [sky.id], active: true });
    expect(rule.ok).toBe(true);
    const run = await admin.runAssignments("unassigned", "run-journey-1");
    expect(run.ok).toBe(true);

    const report = await admin.reports();
    expect(report.ok).toBe(true);
    expect(report.ok && report.data.owners.length).toBeGreaterThan(0);

    // Memory-mode /admin/audit derives events straight off each customer's history "kind"
    // (see apps/api/main.py's admin_audit fallback), so the action here is "Assignment", not
    // the descriptive audit-log phrase append_audit would use in PostgreSQL mode.
    const audit = await admin.audit({ action: "Assignment" });
    expect(audit.ok).toBe(true);
    expect(audit.ok && audit.data.items.length).toBeGreaterThan(0);
  });

  it("deactivating an owning Sales user releases their open customers", async () => {
    const users = await admin.listUsers();
    if (!users.ok) return;
    const river = users.data.find((u) => u.email === "river@example.test")!;
    const before = await admin.getCustomer("700001");
    expect(before.ok && before.data.ownerId).toBe(river.id);
    const deactivated = await admin.updateUser(river.id, { active: false });
    expect(deactivated.ok && deactivated.data.active).toBe(false);
    const after = await admin.getCustomer("700001");
    expect(after.ok && after.data.ownerId).toBe(null);
  });

  // #66: admin-driven password reset, over real HTTP.
  it("resets another user's password, revoking their active session, and is admin-gated", async () => {
    const created = await admin.createUser({ name: "Reset Target", email: "reset-target@example.test", role: "Sales", password: "synthetic-only-original" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const target = createHttpServices({ baseUrl: backend.baseUrl, origin: backend.origin, fetch: newActorFetch() });
    const targetLogin = await target.login("reset-target@example.test", "synthetic-only-original");
    expect(targetLogin.ok).toBe(true);
    expect((await target.currentUser()).ok).toBe(true);

    // Sales-role caller is forbidden. (river was deactivated by an earlier test in this file, so
    // sky -- still active -- is used here.)
    const sales = createHttpServices({ baseUrl: backend.baseUrl, origin: backend.origin, fetch: newActorFetch() });
    expect((await sales.login("sky@example.test", "synthetic-only-sky")).ok).toBe(true);
    const forbidden = await sales.resetUserPassword(created.data.id, "synthetic-only-forbidden");
    expect(forbidden.ok).toBe(false);
    expect(!forbidden.ok && forbidden.error.code).toBe("forbidden");

    // Unknown user -> request-failure (404).
    const missing = await admin.resetUserPassword("does-not-exist", "synthetic-only-missing");
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error.code).toBe("request-failure");

    // Too short -> validation (422).
    const tooShort = await admin.resetUserPassword(created.data.id, "short");
    expect(tooShort.ok).toBe(false);
    expect(!tooShort.ok && tooShort.error.code).toBe("validation");

    const reset = await admin.resetUserPassword(created.data.id, "synthetic-only-reset-password");
    expect(reset.ok).toBe(true);
    expect(reset.ok && Object.keys(reset.data).sort()).toEqual(["active", "email", "id", "name", "role"]);

    // The target's existing session is revoked, the old password no longer works, the new one does.
    expect((await target.currentUser()).ok).toBe(false);
    expect((await target.login("reset-target@example.test", "synthetic-only-original")).ok).toBe(false);
    expect((await target.login("reset-target@example.test", "synthetic-only-reset-password")).ok).toBe(true);
  });
});
