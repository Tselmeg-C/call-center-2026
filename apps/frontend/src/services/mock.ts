import type {
  AssignmentRule,
  AssignmentRuleDraft,
  AssignmentRunResult,
  AuditEvent,
  AuditPage,
  AuditQuery,
  ClosureReason,
  Customer,
  CustomerPage,
  FollowUp,
  FollowUpInput,
  HistoryEvent,
  ImportResult,
  InteractionInput,
  LifecycleInput,
  ListCustomersParams,
  NoteInput,
  ReportData,
  Result,
  ServiceErrorCode,
  Services,
  User,
  UserDraft,
  UserPatch,
  Workload,
  WorkloadBucket,
} from "./types";

// Every mock user shares this synthetic demo password (also used by packages/shared's
// contract-fixtures.json). It is never a real credential and is documented in README.md.
export const MOCK_PASSWORD = "synthetic-only";

type MockUser = User & { password: string };

const failure = <T>(code: ServiceErrorCode, message: string): Result<T> => ({ ok: false, error: { code, message } });
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const casefold = (value: string) => value.trim().toLowerCase();

function seedUsers(): MockUser[] {
  return [
    { id: "admin-demo", name: "Alex Admin", email: "alex@example.test", role: "Admin", active: true, password: MOCK_PASSWORD },
    { id: "sales-river", name: "River Sales", email: "river@example.test", role: "Sales", active: true, password: MOCK_PASSWORD },
    { id: "sales-sky", name: "Sky Sales", email: "sky@example.test", role: "Sales", active: true, password: MOCK_PASSWORD },
  ];
}

function seedReasons(): ClosureReason[] {
  return [
    { id: "closure-1", label: "Won", active: true },
    { id: "closure-2", label: "Lost", active: true },
    { id: "closure-3", label: "No longer a fit", active: true },
  ];
}

function seedCustomers(): Customer[] {
  return [
    {
      bcn: "000123", name: "Acme North", ownerId: "sales-river", ownerName: "River Sales", status: "Open",
      phones: ["(555) 010-0101"], version: 0, histories: [], followUps: [],
      source: { mbcn: "M-00123", propensity_score: 0.98, propensity_tier: "A", propensity_rank: 1, revenue_amount_2025: 128000, payment_terms: "Net 30" },
    },
    {
      bcn: "000124", name: "Beta Rail", ownerId: "sales-sky", ownerName: "Sky Sales", status: "Open",
      phones: ["555 010 0103"], version: 0, histories: [], followUps: [],
      source: { mbcn: "M-00124", propensity_score: 0.7, propensity_tier: "B", propensity_rank: 2, revenue_amount_2025: 42000 },
    },
    {
      bcn: "000125", name: "Cargo Works", ownerId: null, ownerName: null, status: "Open",
      phones: [], version: 0, histories: [], followUps: [],
      source: { mbcn: "M-00125", propensity_score: 0.45, propensity_tier: "C", propensity_rank: 3 },
    },
  ];
}

/** In-memory adapter used for local development and demos (VITE_SERVICE_MODE unset or "mock").
 *  Mirrors the real FastAPI backend's rules (apps/api/main.py) closely enough for the UI to
 *  behave the same way in both modes: idempotent mutations keyed by submissionId, ownership
 *  gates, single-owner-per-rule bulk assignment, and role checks. */
export function createMockServices(): Services {
  let users = seedUsers();
  let reasons = seedReasons();
  let customers = seedCustomers();
  let rules: AssignmentRule[] = [];
  const fallback: string[] = [];
  let auditLog: AuditEvent[] = [];
  let currentUserId: string | null = null;
  let nextId = 1;
  const submissions = new Map<string, unknown>();
  const importFingerprints = new Map<string, string>();
  const sessionListeners = new Set<(user: User | null) => void>();

  const publicUser = (user: MockUser): User => ({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active });
  const findUser = (id: string) => users.find((item) => item.id === id);
  const currentUser = () => (currentUserId ? findUser(currentUserId) ?? null : null);
  const now = () => new Date().toISOString();
  const audit = (actorId: string, action: string, target: string, details: Record<string, unknown>) => {
    auditLog = [{ id: uid("audit"), actor: findUser(actorId)?.name ?? actorId, actorId, action, target, timestamp: now(), details }, ...auditLog];
  };
  const notifySession = () => {
    const user = currentUser();
    sessionListeners.forEach((listener) => listener(user ? publicUser(user) : null));
  };

  function submissionKey(actorId: string, parts: (string | number)[]) {
    return [actorId, ...parts].join(":");
  }
  function idempotent<T>(key: string, compute: () => Result<T>): Result<T> {
    if (submissions.has(key)) return ok(submissions.get(key) as T);
    const result = compute();
    if (result.ok) submissions.set(key, result.data);
    return result;
  }

  function requireAuth(): Result<MockUser> {
    const user = currentUser();
    return user ? ok(user) : failure("unauthenticated", "Sign in to continue.");
  }
  function requireAdmin(): Result<MockUser> {
    const auth = requireAuth();
    if (!auth.ok) return auth;
    return auth.data.role === "Admin" ? ok(auth.data) : failure("forbidden", "Admin access required.");
  }
  function writableCustomer(bcn: string, user: User): Result<Customer> {
    const customer = customers.find((item) => item.bcn === bcn);
    if (!customer) return failure("request-failure", "Customer not found.");
    if (customer.status === "Closed") return failure("conflict", "Customer is closed.");
    if (user.role !== "Admin" && customer.ownerId !== user.id) return failure("forbidden", "Customer access denied.");
    return ok(customer);
  }

  function releaseOwnedCustomers(actor: MockUser, ownerId: string) {
    customers = customers.map((customer) => {
      if (customer.ownerId !== ownerId || customer.status !== "Open") return customer;
      const event: HistoryEvent = { id: uid("assignment"), bcn: customer.bcn, kind: "Assignment", actor: actor.name, actorId: actor.id, timestamp: now(), oldOwner: ownerId, newOwner: null, reason: "Owner deactivated" };
      audit(actor.id, "Customer ownership released", customer.bcn, { oldOwner: ownerId, newOwner: null, reason: "Owner deactivated" });
      return { ...customer, ownerId: null, ownerName: null, version: customer.version + 1, histories: [...customer.histories, event] };
    });
  }

  return {
    login: (email, password) => {
      const record = users.find((item) => casefold(item.email) === casefold(email));
      if (!record || !record.active || record.password !== password) return Promise.resolve(failure("unauthenticated", "Unable to sign in."));
      currentUserId = record.id;
      notifySession();
      return Promise.resolve(ok(publicUser(record)));
    },
    logout: () => {
      currentUserId = null;
      notifySession();
      return Promise.resolve(ok(null));
    },
    currentUser: () => {
      const user = currentUser();
      return Promise.resolve(user ? ok(publicUser(user)) : failure("unauthenticated", "Sign in to continue."));
    },
    subscribeSession: (listener) => {
      sessionListeners.add(listener);
      listener(currentUser() ? publicUser(currentUser()!) : null);
      return () => sessionListeners.delete(listener);
    },

    listCustomers: (params: ListCustomersParams = {}) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      let rows = customers;
      if (params.mine) rows = rows.filter((item) => item.ownerId === auth.data.id);
      if (params.owner === "unassigned") rows = rows.filter((item) => !item.ownerId);
      else if (params.owner) rows = rows.filter((item) => item.ownerId === params.owner);
      if (params.status) rows = rows.filter((item) => item.status === params.status);
      if (params.q) {
        const q = casefold(params.q);
        rows = rows.filter((item) => `${item.bcn} ${item.name}`.toLowerCase().includes(q));
      }
      const page = params.page ?? 1;
      const pageSize = params.page_size ?? 25;
      const start = (page - 1) * pageSize;
      const page_data: CustomerPage = { items: rows.slice(start, start + pageSize).map((item) => ({ ...item })), page, page_size: pageSize, total: rows.length };
      return Promise.resolve(ok(page_data));
    },
    getCustomer: (bcn) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const customer = customers.find((item) => item.bcn === bcn);
      return Promise.resolve(customer ? ok({ ...customer }) : failure("request-failure", "Customer not found."));
    },
    workload: () => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      if (auth.data.role !== "Sales") return Promise.resolve(failure("forbidden", "Sales access required."));
      const today = now().slice(0, 10);
      const owned = customers.filter((item) => item.ownerId === auth.data.id && item.status === "Open");
      const counts: Record<WorkloadBucket, number> = { overdue: 0, today: 0, undated: 0, "never-contacted": 0, other: 0 };
      const rows = owned.map((customer) => {
        const open = customer.followUps.filter((item) => item.status === "Open");
        const overdue = open.some((item) => item.due && item.due.slice(0, 10) < today);
        const dueToday = open.some((item) => item.due && item.due.slice(0, 10) === today);
        const undated = open.some((item) => !item.due);
        const contacted = customer.histories.some((event) => event.kind === "Interaction" && !event.deleted);
        const bucket: WorkloadBucket = overdue ? "overdue" : dueToday ? "today" : undated ? "undated" : !contacted ? "never-contacted" : "other";
        counts[bucket] += 1;
        return { ...customer, workloadBucket: bucket, relevantDue: null };
      });
      const workload: Workload = { asOf: now(), today, counts, customers: rows };
      return Promise.resolve(ok(workload));
    },

    createInteraction: (bcn, input: InteractionInput) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const key = submissionKey(auth.data.id, [bcn, "interaction", input.submissionId]);
      const result = idempotent<HistoryEvent>(key, () => {
        const writable = writableCustomer(bcn, auth.data);
        if (!writable.ok) return writable;
        if (input.outcome !== "Attempt" && input.outcome !== "Contact") return failure("validation", "Invalid outcome.");
        const record: HistoryEvent = { id: uid("interaction"), bcn, kind: "Interaction", outcome: input.outcome, text: input.note ?? null, actor: auth.data.name, actorId: auth.data.id, timestamp: now(), deleted: false };
        customers = customers.map((item) => (item.bcn === bcn ? { ...item, histories: [...item.histories, record] } : item));
        return ok(record);
      });
      return Promise.resolve(result);
    },
    createNote: (bcn, input: NoteInput) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const key = submissionKey(auth.data.id, [bcn, "note", input.submissionId]);
      const result = idempotent<HistoryEvent>(key, () => {
        const writable = writableCustomer(bcn, auth.data);
        if (!writable.ok) return writable;
        if (!input.text.trim()) return failure("validation", "Note text is required.");
        const record: HistoryEvent = { id: uid("note"), bcn, kind: "Standalone note", text: input.text, actor: auth.data.name, actorId: auth.data.id, timestamp: now(), deleted: false };
        customers = customers.map((item) => (item.bcn === bcn ? { ...item, histories: [...item.histories, record] } : item));
        return ok(record);
      });
      return Promise.resolve(result);
    },
    deleteHistory: (bcn, recordId) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const customer = customers.find((item) => item.bcn === bcn);
      if (!customer) return Promise.resolve(failure("request-failure", "Customer not found."));
      const record = customer.histories.find((item) => item.id === recordId);
      if (!record) return Promise.resolve(failure("request-failure", "Record not found."));
      if (auth.data.role !== "Admin" && customer.ownerId !== auth.data.id) return Promise.resolve(failure("forbidden", "Record access denied."));
      const deletedAt = now();
      const updated: HistoryEvent = { ...record, deleted: true, deletedBy: auth.data.id, deletedAt, text: null };
      customers = customers.map((item) => (item.bcn === bcn ? { ...item, histories: item.histories.map((h) => (h.id === recordId ? updated : h)) } : item));
      return Promise.resolve(ok(updated));
    },

    createFollowUp: (bcn, input: FollowUpInput) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const key = submissionKey(auth.data.id, [bcn, "followup", input.submissionId]);
      const result = idempotent<FollowUp>(key, () => {
        const writable = writableCustomer(bcn, auth.data);
        if (!writable.ok) return writable;
        if (input.type !== "Appointment" && input.type !== "Reminder") return failure("validation", "Invalid follow-up type.");
        if (!input.note.trim()) return failure("validation", "Follow-up note is required.");
        const record: FollowUp = { id: uid("followup"), bcn, type: input.type, due: input.due ?? null, note: input.note, status: "Open", actorId: auth.data.id, createdAt: now() };
        customers = customers.map((item) => (item.bcn === bcn ? { ...item, followUps: [...item.followUps, record] } : item));
        return ok(record);
      });
      return Promise.resolve(result);
    },
    updateFollowUp: (bcn, followUpId, input: FollowUpInput) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const key = submissionKey(auth.data.id, [bcn, "followup-edit", followUpId, input.submissionId]);
      const result = idempotent<FollowUp>(key, () => {
        const writable = writableCustomer(bcn, auth.data);
        if (!writable.ok) return writable;
        const item = writable.data.followUps.find((f) => f.id === followUpId);
        if (!item) return failure("request-failure", "Follow-up not found.");
        if (item.status !== "Open") return failure("conflict", "Follow-up is no longer open.");
        const updated: FollowUp = { ...item, type: input.type, due: input.due ?? null, note: input.note, updatedAt: now() };
        customers = customers.map((c) => (c.bcn === bcn ? { ...c, followUps: c.followUps.map((f) => (f.id === followUpId ? updated : f)) } : c));
        return ok(updated);
      });
      return Promise.resolve(result);
    },
    cancelFollowUp: (bcn, followUpId, submissionId) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const key = submissionKey(auth.data.id, [bcn, "followup-cancel", followUpId, submissionId]);
      const result = idempotent<FollowUp>(key, () => {
        const writable = writableCustomer(bcn, auth.data);
        if (!writable.ok) return writable;
        const item = writable.data.followUps.find((f) => f.id === followUpId);
        if (!item) return failure("request-failure", "Follow-up not found.");
        if (item.status === "Cancelled") return ok(item);
        if (item.status === "Completed") return failure("conflict", "Follow-up is completed.");
        const updated: FollowUp = { ...item, status: "Cancelled", updatedAt: now() };
        customers = customers.map((c) => (c.bcn === bcn ? { ...c, followUps: c.followUps.map((f) => (f.id === followUpId ? updated : f)) } : c));
        return ok(updated);
      });
      return Promise.resolve(result);
    },
    completeFollowUp: (bcn, followUpId, input: InteractionInput) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const key = submissionKey(auth.data.id, [bcn, "followup-complete", followUpId, input.submissionId]);
      const result = idempotent<FollowUp>(key, () => {
        const writable = writableCustomer(bcn, auth.data);
        if (!writable.ok) return writable;
        const item = writable.data.followUps.find((f) => f.id === followUpId);
        if (!item) return failure("request-failure", "Follow-up not found.");
        if (item.status === "Completed") return ok(item);
        if (item.status !== "Open") return failure("conflict", "Follow-up is not open.");
        const interaction: HistoryEvent = { id: uid("interaction"), bcn, kind: "Interaction", outcome: input.outcome, text: input.note ?? null, actor: auth.data.name, actorId: auth.data.id, timestamp: now(), deleted: false };
        const updated: FollowUp = { ...item, status: "Completed", interactionId: interaction.id, updatedAt: now() };
        customers = customers.map((c) => (c.bcn === bcn ? { ...c, histories: [...c.histories, interaction], followUps: c.followUps.map((f) => (f.id === followUpId ? updated : f)) } : c));
        return ok(updated);
      });
      return Promise.resolve(result);
    },

    closeCustomer: (bcn, input: LifecycleInput) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const key = submissionKey(auth.data.id, [bcn, "close", input.submissionId]);
      const result = idempotent<Customer>(key, () => {
        const writable = writableCustomer(bcn, auth.data);
        if (!writable.ok) return writable;
        const reason = reasons.find((item) => item.id === input.reasonId && item.active);
        if (!reason) return failure("validation", "Choose an active closure reason.");
        const timestamp = now();
        const event: HistoryEvent = { id: uid("closure"), bcn, kind: "Closure", reasonId: reason.id, reason: reason.label, actor: auth.data.name, actorId: auth.data.id, timestamp };
        const closed: Customer = {
          ...writable.data, status: "Closed", version: writable.data.version + 1,
          histories: [...writable.data.histories, event],
          followUps: writable.data.followUps.map((f) => (f.status === "Open" ? { ...f, status: "Cancelled", updatedAt: timestamp } : f)),
        };
        customers = customers.map((item) => (item.bcn === bcn ? closed : item));
        audit(auth.data.id, "Customer closed", bcn, { reasonId: reason.id, reason: reason.label });
        return ok(closed);
      });
      return Promise.resolve(result);
    },
    reopenCustomer: (bcn, input: LifecycleInput) => {
      const auth = requireAuth();
      if (!auth.ok) return Promise.resolve(auth);
      const customer = customers.find((item) => item.bcn === bcn);
      if (!customer) return Promise.resolve(failure("request-failure", "Customer not found."));
      if (auth.data.role !== "Admin" && customer.ownerId !== auth.data.id) return Promise.resolve(failure("forbidden", "Customer access denied."));
      const key = submissionKey(auth.data.id, [bcn, "reopen", input.submissionId]);
      const result = idempotent<Customer>(key, () => {
        const timestamp = now();
        const event: HistoryEvent = { id: uid("reopen"), bcn, kind: "Reopen", actor: auth.data.name, actorId: auth.data.id, timestamp };
        const reopened: Customer = { ...customer, status: "Open", version: customer.version + 1, histories: [...customer.histories, event] };
        customers = customers.map((item) => (item.bcn === bcn ? reopened : item));
        audit(auth.data.id, "Customer reopened", bcn, {});
        return ok(reopened);
      });
      return Promise.resolve(result);
    },

    listUsers: () => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      return Promise.resolve(ok(users.map(publicUser)));
    },
    createUser: (input: UserDraft) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      if (!input.name.trim() || input.name.length > 120) return Promise.resolve(failure("validation", "Name must be 1-120 characters."));
      if (users.some((item) => casefold(item.email) === casefold(input.email))) return Promise.resolve(failure("conflict", "normalized identity already exists"));
      if (input.role !== "Admin" && input.role !== "Sales") return Promise.resolve(failure("validation", "Invalid role."));
      const record: MockUser = { id: uid("user"), name: input.name.trim(), email: casefold(input.email), role: input.role, active: true, password: input.password };
      users = [...users, record];
      audit(admin.data.id, "User created", record.id, { name: record.name, role: record.role });
      return Promise.resolve(ok(publicUser(record)));
    },
    updateUser: (id, patch: UserPatch) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      const target = findUser(id);
      if (!target) return Promise.resolve(failure("request-failure", "User not found."));
      if (id === admin.data.id && (patch.active === false || patch.role === "Sales")) return Promise.resolve(failure("validation", "Cannot disable or demote yourself."));
      const wasActiveSales = target.role === "Sales" && target.active;
      const updated: MockUser = { ...target, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.role !== undefined ? { role: patch.role } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}) };
      users = users.map((item) => (item.id === id ? updated : item));
      audit(admin.data.id, "User changed", id, { name: updated.name, role: updated.role, active: updated.active });
      if (wasActiveSales && (updated.active === false || updated.role !== "Sales")) releaseOwnedCustomers(admin.data, id);
      return Promise.resolve(ok(publicUser(updated)));
    },

    listClosureReasons: () => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      return Promise.resolve(ok(reasons.map((item) => ({ ...item }))));
    },
    createClosureReason: (label) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      const value = label.trim();
      if (!value || value.length > 120) return Promise.resolve(failure("validation", "Reason must be 1-120 characters."));
      if (reasons.some((item) => casefold(item.label) === casefold(value))) return Promise.resolve(failure("conflict", "Reason already exists."));
      const reason: ClosureReason = { id: uid("closure"), label: value, active: true };
      reasons = [...reasons, reason];
      audit(admin.data.id, "Closure reason created", reason.id, { label: reason.label });
      return Promise.resolve(ok(reason));
    },
    updateClosureReason: (id, patch) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      const target = reasons.find((item) => item.id === id);
      if (!target) return Promise.resolve(failure("request-failure", "Reason not found."));
      const label = patch.label?.trim() || target.label;
      if (reasons.some((item) => item.id !== id && casefold(item.label) === casefold(label))) return Promise.resolve(failure("conflict", "Reason already exists."));
      const updated: ClosureReason = { ...target, label, ...(patch.active !== undefined ? { active: patch.active } : {}) };
      reasons = reasons.map((item) => (item.id === id ? updated : item));
      audit(admin.data.id, "Closure reason changed", id, { label: updated.label, active: updated.active });
      return Promise.resolve(ok(updated));
    },

    importWorkbook: async (file, submissionId) => {
      const admin = requireAdmin();
      if (!admin.ok) return admin;
      if (!file.name.toLowerCase().endsWith(".xlsx")) return failure("validation", "Upload an .xlsx workbook.");
      if (file.size > 10 * 1024 * 1024) return failure("validation", "Workbook is too large.");
      // ponytail: the mock does not parse real spreadsheet bytes (openpyxl does that server-side in
      // apps/api/main.py); it only needs to look and behave like a believable import for local/demo
      // use, including reimport idempotency by submissionId+content.
      const bytes = new Uint8Array(await file.arrayBuffer());
      let checksum = 0;
      for (const byte of bytes) checksum = (checksum * 31 + byte) >>> 0;
      const fingerprint = `${bytes.length}:${checksum}`;
      const key = submissionKey(admin.data.id, ["import", submissionId]);
      if (importFingerprints.has(key)) {
        if (importFingerprints.get(key) !== fingerprint) return failure("conflict", "Submission already used.");
        return ok(submissions.get(key) as ImportResult);
      }
      const bcn = String(100000 + (nextId++)).padStart(6, "0");
      const created = !customers.some((item) => item.bcn === bcn);
      if (created) customers = [...customers, { bcn, name: `Imported ${bcn}`, ownerId: null, ownerName: null, status: "Open", phones: [], source: { customer_name: `Imported ${bcn}` }, version: 0, histories: [], followUps: [] }];
      const result: ImportResult = { jobId: uid("import"), submissionId, filename: file.name, completedAt: now(), status: "Completed", created: created ? 1 : 0, updated: created ? 0 : 1, processed: 1, errorRows: 0, errors: [] };
      importFingerprints.set(key, fingerprint);
      submissions.set(key, result);
      audit(admin.data.id, "Import completed", result.jobId, { created: result.created, updated: result.updated, errors: 0 });
      return ok(result);
    },

    assignCustomer: (bcn, ownerId, submissionId, expectedVersion) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      const key = submissionKey(admin.data.id, [bcn, "assign", submissionId]);
      const result = idempotent<Customer>(key, () => {
        const customer = customers.find((item) => item.bcn === bcn);
        if (!customer) return failure("request-failure", "Customer not found.");
        if (expectedVersion !== undefined && expectedVersion !== customer.version) return failure("conflict", "Customer changed. Reload before saving.");
        if (ownerId && !users.some((item) => item.id === ownerId && item.role === "Sales" && item.active)) return failure("validation", "Owner must be an active Sales user.");
        const owner = ownerId ? findUser(ownerId) : undefined;
        const oldOwner = customer.ownerId;
        const event: HistoryEvent = { id: uid("assignment"), bcn, kind: "Assignment", actor: admin.data.name, actorId: admin.data.id, timestamp: now(), oldOwner, newOwner: ownerId, reason: "Manual assignment" };
        const updated: Customer = { ...customer, ownerId, ownerName: owner?.name ?? null, version: customer.version + 1, histories: [...customer.histories, event] };
        customers = customers.map((item) => (item.bcn === bcn ? updated : item));
        audit(admin.data.id, "Customer assigned", bcn, { oldOwner, newOwner: ownerId });
        return ok(updated);
      });
      return Promise.resolve(result);
    },
    listAssignmentRules: () => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      return Promise.resolve(ok(rules.map((item) => ({ ...item }))));
    },
    createAssignmentRule: (input: AssignmentRuleDraft) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      const name = input.name.trim();
      if (!name || name.length > 120) return Promise.resolve(failure("validation", "Name must be 1-120 characters."));
      if (rules.some((item) => casefold(item.name) === casefold(name))) return Promise.resolve(failure("conflict", "Rule already exists."));
      const owner = findUser(input.ownerId);
      if (!owner || owner.role !== "Sales" || !owner.active) return Promise.resolve(failure("validation", "Owner must be active Sales."));
      const rule: AssignmentRule = { id: uid("rule"), name, ownerId: input.ownerId, active: input.active ?? true, order: rules.length + 1 };
      rules = [...rules, rule];
      audit(admin.data.id, "Assignment rule created", rule.id, { name: rule.name });
      return Promise.resolve(ok(rule));
    },
    updateAssignmentRule: (id, patch) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      const target = rules.find((item) => item.id === id);
      if (!target) return Promise.resolve(failure("request-failure", "Rule not found."));
      if (patch.name && rules.some((item) => item.id !== id && casefold(item.name) === casefold(patch.name!))) return Promise.resolve(failure("conflict", "Rule already exists."));
      if (patch.ownerId) {
        const owner = findUser(patch.ownerId);
        if (!owner || owner.role !== "Sales" || !owner.active) return Promise.resolve(failure("validation", "Owner must be active Sales."));
      }
      const updated: AssignmentRule = { ...target, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}), ...(patch.order !== undefined ? { order: patch.order } : {}) };
      rules = rules.map((item) => (item.id === id ? updated : item)).sort((a, b) => a.order - b.order);
      return Promise.resolve(ok(updated));
    },
    runAssignments: (scope, submissionId) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      const key = submissionKey(admin.data.id, ["run", submissionId]);
      const result = idempotent<AssignmentRunResult>(key, () => {
        if (scope !== "unassigned" && scope !== "all-open") return failure("validation", "Invalid assignment scope.");
        const eligible = new Set(users.filter((item) => item.role === "Sales" && item.active).map((item) => item.id));
        const owners = rules.filter((item) => item.active && eligible.has(item.ownerId)).sort((a, b) => a.order - b.order).map((item) => item.ownerId);
        const pool = owners.length ? owners : fallback.filter((id) => eligible.has(id));
        const candidates = customers.filter((item) => item.status === "Open" && (scope === "all-open" || !item.ownerId));
        let assigned = 0;
        if (pool.length) {
          const winner = pool[0]!;
          const owner = findUser(winner);
          customers = customers.map((customer) => {
            if (!(customer.status === "Open" && (scope === "all-open" || !customer.ownerId)) || customer.ownerId === winner) return customer;
            assigned += 1;
            const event: HistoryEvent = { id: uid("assignment"), bcn: customer.bcn, kind: "Assignment", actor: admin.data.name, actorId: admin.data.id, timestamp: now(), oldOwner: customer.ownerId, newOwner: winner, reason: "Bulk assignment" };
            audit(admin.data.id, "Customer assigned", customer.bcn, { oldOwner: customer.ownerId, newOwner: winner, source: "bulk" });
            return { ...customer, ownerId: winner, ownerName: owner?.name ?? null, version: customer.version + 1, histories: [...customer.histories, event] };
          });
        }
        return ok<AssignmentRunResult>({ submissionId, scope, candidates: candidates.length, assigned, skipped: candidates.length - assigned });
      });
      return Promise.resolve(result);
    },

    reports: (start, end) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      if (start && end && start > end) return Promise.resolve(failure("validation", "Start date must not be after end date."));
      const owners = new Map<string, ReportData["owners"][number]>();
      for (const customer of customers) {
        const key = customer.ownerId ?? "unassigned";
        const row = owners.get(key) ?? { ownerId: customer.ownerId, owner: customer.ownerName ?? "Unassigned", open: 0, closed: 0, neverContacted: 0, attempts: 0, contacts: 0, contactRate: null, pendingFollowUps: 0 };
        owners.set(key, row);
        row[customer.status === "Open" ? "open" : "closed"] += 1;
        if (customer.status === "Open" && !customer.histories.some((event) => event.kind === "Interaction" && !event.deleted)) row.neverContacted += 1;
        row.pendingFollowUps += customer.followUps.filter((item) => item.status === "Open").length;
        for (const event of customer.histories) {
          if (event.deleted || event.kind !== "Interaction") continue;
          const date = (event.timestamp ?? "").slice(0, 10);
          if ((start && date < start) || (end && date > end)) continue;
          if (event.outcome === "Attempt") row.attempts += 1;
          else if (event.outcome === "Contact") row.contacts += 1;
        }
      }
      owners.forEach((row) => { row.contactRate = row.attempts ? Number(((row.contacts / row.attempts) * 100).toFixed(1)) : null; });
      const daily = new Map<string, { date: string; attempts: number; contacts: number }>();
      for (const customer of customers) for (const event of customer.histories) {
        if (event.deleted || event.kind !== "Interaction") continue;
        const date = (event.timestamp ?? "").slice(0, 10);
        if ((start && date < start) || (end && date > end)) continue;
        const row = daily.get(date) ?? { date, attempts: 0, contacts: 0 };
        if (event.outcome === "Attempt") row.attempts += 1;
        else if (event.outcome === "Contact") row.contacts += 1;
        daily.set(date, row);
      }
      const allFollowUps = customers.flatMap((item) => item.followUps);
      const today = now().slice(0, 10);
      const followUps = { overdue: allFollowUps.filter((f) => f.status === "Open" && f.due && f.due.slice(0, 10) < today).length, today: allFollowUps.filter((f) => f.status === "Open" && f.due && f.due.slice(0, 10) === today).length, undated: allFollowUps.filter((f) => f.status === "Open" && !f.due).length, completed: allFollowUps.filter((f) => f.status === "Completed").length };
      return Promise.resolve(ok<ReportData>({ owners: [...owners.values()], daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)), closureReasons: reasons.map((item) => ({ ...item })), followUps }));
    },
    audit: (query: AuditQuery = {}) => {
      const admin = requireAdmin();
      if (!admin.ok) return Promise.resolve(admin);
      let events = auditLog;
      if (query.actor) events = events.filter((item) => item.actorId === query.actor || casefold(item.actor).includes(casefold(query.actor!)));
      if (query.action) events = events.filter((item) => item.action === query.action);
      if (query.bcn) events = events.filter((item) => item.target === query.bcn);
      const page = query.page ?? 1;
      const pageSize = query.page_size ?? 25;
      const start = (page - 1) * pageSize;
      return Promise.resolve(ok<AuditPage>({ items: events.slice(start, start + pageSize), page, page_size: pageSize, total: events.length }));
    },
  };
}
