import type { AssignmentRule, AuditEvent, ClosureReason, CreateInteractionInput, CreateNoteInput, Customer, CustomerDetail, FollowUp, FollowUpInput, HistoryRecord, ImportResult, MockControls, MockSnapshot, ReportData, Result, SampleRecord, Services, User, UpdateFollowUpInput, CompleteFollowUpInput, LifecycleInput } from "./types";
import { calculateWorkload } from "./workload";

const seedUsers: User[] = [
  { id: "admin-demo", name: "Alex Admin", email: "alex@example.test", role: "Admin", active: true },
  { id: "sales-river", name: "River Sales", email: "river@example.test", role: "Sales", active: true },
  { id: "sales-sky", name: "Sky Sales", email: "sky@example.test", role: "Sales", active: true },
];
const failure = <T>(code: "unauthenticated" | "forbidden" | "request-failure" | "validation" | "conflict", message: string): Result<T> => ({ ok: false, error: { code, message } });
const seedReasons: ClosureReason[] = ["Won", "Lost", "No longer a fit", "Duplicate", "Unreachable", "Out of territory", "Other"].map((label, i) => ({ id: `closure-${i + 1}`, label, active: true }));
const seedRules = (): AssignmentRule[] => [{ id: "rule-tier-a", name: "Tier A", active: true, position: 1, field: "propensityTier", operator: "=", value: "A", eligibleSalesIds: ["sales-river"] }];
const customerFixtures: CustomerDetail[] = [
  { bcn: "000123", mbcn: "M-00123", name: "Acme North", ownerId: "sales-river", ownerName: "River Sales", status: "Open", previouslyContacted: false, recent: true, propensityTier: "A", propensityRank: 1, propensityScore: 0.98, phones: ["(555) 010-0101", "555-010-0102"], nextFollowUp: "2026-09-12", contactStatus: "No recorded interaction", source: { bcn: "000123", MBCN: "M-00123", customer_name: "Acme North", phone: "(555) 010-0101", previously_contacted: false, propensity_score: 0.98, propensity_tier: "A", propensity_rank: 1, Inside_Lead: "Lead A", Field_Rep: null, SC_Naming: "SC-1", Inside_Rep: "River Sales", Branch_Code: "001", RSM_Name: "RSM North", Originating_BU: "North", LAST_PURCHASE_DATE: null, recent: true, REVENUE_AMOUNT_2024: 1000, REVENUE_AMOUNT_2025: null, REVENUE_AMOUNT_2026: 1200, FEM_AMOUNT_2024: null, FEM_AMOUNT_2025: null, FEM_AMOUNT_2026: null, Payment_Terms: "Net 30", vendor_1: null, vendor_1_revenue: null, vendor_2: null, vendor_2_revenue: null, vendor_3: null, vendor_3_revenue: null, category_1: "Industrial", category_1_revenue: 1200, category_2: null, category_2_revenue: null, category_3: null, category_3_revenue: null }, histories: [], followUps: [{ id: "fu-fixture-1", bcn: "000123", type: "Reminder", due: "2026-09-12", dueKind: "date", note: "Call back", status: "Open", actor: "River Sales", actorId: "sales-river", createdAt: "2026-09-10T10:00:00Z", updatedAt: "2026-09-10T10:00:00Z" }] },
  { bcn: "000124", mbcn: "M-00124", name: "Acme North", ownerId: "sales-sky", ownerName: "Sky Sales", status: "Closed", previouslyContacted: true, recent: false, propensityTier: "B", propensityRank: 2, propensityScore: 0.7, phones: ["555 010 0103"], nextFollowUp: null, contactStatus: "Contact", source: { bcn: "000124", MBCN: "M-00124", customer_name: "Acme North", phone: "555 010 0103", previously_contacted: true, propensity_score: 0.7, propensity_tier: "B", propensity_rank: 2, Inside_Lead: null, Field_Rep: "Rep B", SC_Naming: null, Inside_Rep: "Sky Sales", Branch_Code: "002", RSM_Name: null, Originating_BU: "West", LAST_PURCHASE_DATE: "2026-01-04", recent: false, REVENUE_AMOUNT_2024: 200, REVENUE_AMOUNT_2025: 300, REVENUE_AMOUNT_2026: 400, FEM_AMOUNT_2024: null, FEM_AMOUNT_2025: null, FEM_AMOUNT_2026: null, Payment_Terms: null, vendor_1: "Vendor", vendor_1_revenue: 20, vendor_2: null, vendor_2_revenue: null, vendor_3: null, vendor_3_revenue: null, category_1: null, category_1_revenue: null, category_2: null, category_2_revenue: null, category_3: null, category_3_revenue: null }, histories: Array.from({ length: 30 }, (_, i) => ({ kind: ["Interaction", "Standalone note", "Follow-up", "Assignment", "Closure", "Reopen"][i % 6], id: `i-${i + 1}`, actor: "Sky Sales", timestamp: `2026-09-${String(30 - i).padStart(2, "0")}T10:00:00Z`, text: i % 2 ? "Attempt" : "Contact", ...(i === 0 ? { attachedNoteId: "note-fixture-1" } : {}), ...(i === 2 ? { interactionId: "i-1", followUpStatus: "Completed" as const } : {}) })), followUps: [], closure: { reasonId: "closure-1", reason: "Won", actor: "Sky Sales", actorId: "sales-sky", timestamp: "2026-09-26T10:00:00Z" } },
  { bcn: "000125", mbcn: "M-00125", name: "Beta Works", ownerId: null, ownerName: null, status: "Open", previouslyContacted: false, recent: false, propensityTier: null, propensityRank: null, propensityScore: null, phones: [], nextFollowUp: null, contactStatus: "No recorded interaction", source: { bcn: "000125", MBCN: "M-00125", customer_name: "Beta Works", phone: null, previously_contacted: false, propensity_score: null, propensity_tier: null, propensity_rank: null, Inside_Lead: null, Field_Rep: null, SC_Naming: null, Inside_Rep: null, Branch_Code: null, RSM_Name: null, Originating_BU: null, LAST_PURCHASE_DATE: null, recent: false, REVENUE_AMOUNT_2024: null, REVENUE_AMOUNT_2025: null, REVENUE_AMOUNT_2026: null, FEM_AMOUNT_2024: null, FEM_AMOUNT_2025: null, FEM_AMOUNT_2026: null, Payment_Terms: null, vendor_1: null, vendor_1_revenue: null, vendor_2: null, vendor_2_revenue: null, vendor_3: null, vendor_3_revenue: null, category_1: null, category_1_revenue: null, category_2: null, category_2_revenue: null, category_3: null, category_3_revenue: null }, histories: [], followUps: [] },
];

export function createMockAdapter(options: { now?: () => string } = {}): { services: Services; controls: MockControls } {
  let personas = seedUsers.map(user => ({ ...user }));
  let closureReasons = seedReasons.map(reason => ({ ...reason }));
  let assignmentRules: AssignmentRule[] = seedRules();
  let fallbackSalesIds = ["sales-river", "sales-sky"];
  let assignmentVersion = 1;
  let user: User | null = null;
  let generation = 0;
  let failNext = false;
  let snapshot: MockSnapshot = { scenario: "Normal", revision: 0, reset: 0, notice: "" };
  const fixtures = () => Object.fromEntries(personas.map(persona => [persona.id, [{ id: `${persona.id}-sample`, label: `${persona.name}'s synthetic service record` }]]));
  let records: Record<string, SampleRecord[]> = fixtures();
  const cloneCustomer = (customer: CustomerDetail) => ({ ...customer, histories: customer.histories.map(history => ({ ...history })), followUps: customer.followUps.map(followUp => ({ ...followUp })), closure: customer.closure ? { ...customer.closure } : undefined });
  let customers = customerFixtures.map(cloneCustomer);
  let nextRecord = 1;
  const submissions = new Map<string, HistoryRecord>();
  const followUpSubmissions = new Map<string, FollowUp>();
  const lifecycleSubmissions = new Map<string, CustomerDetail>();
  const assignmentSubmissions = new Map<string, import("./types").AssignmentRunResult>();
  const auditEvents: AuditEvent[] = [];
  const recordAudit = (action: string, target: string, details: Record<string, string | number | null>) => { if (user) auditEvents.push({ id: `audit-${nextRecord++}`, actor: user.name, actorId: user.id, action, target, timestamp: now(), details }); };
  const now = options.now ?? (() => new Date().toISOString());
  const listeners = new Set<() => void>();
  const sessionListeners = new Set<(user: User | null) => void>();
  const pending = new Set<() => void>();
  const wake = () => { pending.forEach(resolve => resolve()); pending.clear(); };
  const clearSession = () => { generation++; user = null; sessionListeners.forEach(listener => listener(null)); wake(); };
  const publish = () => { snapshot = { ...snapshot, revision: snapshot.revision + 1 }; listeners.forEach(listener => listener()); };
  async function request<T>(read: () => Result<T>): Promise<Result<T>> {
    const started = generation;
    while (snapshot.scenario === "Loading" && started === generation) {
      await new Promise<void>(resolve => pending.add(resolve));
    }
    await Promise.resolve();
    if (started !== generation) return failure("unauthenticated", "The session changed. Sign in again.");
    if (failNext) { failNext = false; return failure("request-failure", "The mock request failed. Please retry."); }
    return read();
  }
  const services: Services = {
    signIn: id => request(() => {
      const selected = personas.find(persona => persona.id === id && persona.active !== false);
      if (!selected) return failure("forbidden", "Choose a valid active mock persona.");
      generation++;
      user = { ...selected };
      snapshot = { ...snapshot, notice: "" };
      sessionListeners.forEach(listener => listener(user));
      publish();
      wake();
      return { ok: true, data: { ...user } };
    }),
    signOut: async () => { clearSession(); return { ok: true, data: null }; },
    currentUser: async () => user ? { ok: true, data: { ...user } } : failure("unauthenticated", "Sign in to continue."),
    sampleRecords: () => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => user ? { ok: true, data: snapshot.scenario === "Empty" ? [] : records[user.id].map(record => ({ ...record })) } : failure("unauthenticated", "Sign in to continue."));
    },
    listCustomers: () => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => ({ ok: true, data: customers.map(({ histories, source, ...customer }) => { void histories; void source; return { ...customer }; }) }));
    },
    workload: () => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => ({ ok: true, data: calculateWorkload(customers, user!, now()) }));
    },
    getCustomer: bcn => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => { const customer = customers.find(item => item.bcn === bcn); return customer ? { ok: true, data: { ...cloneCustomer(customer), histories: [...customer.histories].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)), followUps: customer.followUps.map(f => ({ ...f })) } } : failure("request-failure", "Customer not found."); });
    },
    createInteraction: input => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => createInteraction(input));
    },
    createNote: input => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => createNote(input));
    },
    createFollowUp: input => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => createFollowUp(input));
    },
    updateFollowUp: input => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => updateFollowUp(input));
    },
    cancelFollowUp: (bcn, followUpId, submissionId) => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => cancelFollowUp(bcn, followUpId, submissionId));
    },
    completeFollowUp: input => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => completeFollowUp(input));
    },
    closeCustomer: input => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => closeCustomer(input));
    },
    reopenCustomer: input => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => reopenCustomer(input));
    },
    closureReasons: () => Promise.resolve({ ok: true, data: closureReasons.map(reason => ({ ...reason })) }),
    listUsers: () => user?.role === "Admin" ? Promise.resolve({ ok: true, data: personas.map(item => ({ ...item })) }) : Promise.resolve(failure("forbidden", "Admin access required.")),
    createUser: input => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required."));
      const name = input.name?.trim() ?? "", email = input.email?.trim() ?? "";
      if (name.length < 1 || name.length > 120) return Promise.resolve(failure("validation", "Name must be 1–120 characters."));
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return Promise.resolve(failure("validation", "Enter a valid email address."));
      if (personas.some(item => item.email?.trim().toLowerCase() === email.toLowerCase())) return Promise.resolve(failure("conflict", "Email is already in use."));
      const created = { id: `user-${personas.length + 1}`, name, email, role: input.role, active: true } as User;
      personas = [...personas, created]; recordAudit("User created", created.id, { role: created.role, active: 1 }); records = fixtures(); publish(); return Promise.resolve({ ok: true, data: { ...created } });
    },
    updateUser: (id, patch) => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required."));
      const target = personas.find(item => item.id === id); if (!target) return Promise.resolve(failure("request-failure", "User not found."));
      const nextRole = patch.role ?? target.role, nextActive = patch.active ?? target.active !== false;
      if (id === user.id && (nextRole !== target.role || !nextActive)) return Promise.resolve(failure("conflict", "You cannot deactivate or demote your current session."));
      if (target.role === "Admin" && (nextRole !== "Admin" || !nextActive) && personas.filter(item => item.role === "Admin" && item.active !== false && item.id !== id).length === 0) return Promise.resolve(failure("conflict", "At least one active Admin is required."));
      personas = personas.map(item => item.id === id ? { ...item, ...patch, name: patch.name?.trim() || item.name, active: nextActive, role: nextRole } : item);
      if ((target.role === "Sales" && (nextRole === "Admin" || !nextActive))) customers.forEach(customer => { if (customer.status === "Open" && customer.ownerId === id) { customer.histories.push({ id: `assignment-${nextRecord++}`, kind: "Assignment", actor: user!.name, actorId: user!.id, timestamp: now(), text: `${customer.ownerName ?? target.name} released to Unassigned`, before: { ownerId: id }, after: { ownerId: null } }); customer.ownerId = null; customer.ownerName = null; } });
      recordAudit("User changed", id, { beforeRole: target.role, afterRole: nextRole, beforeActive: target.active === false ? 0 : 1, afterActive: nextActive ? 1 : 0 }); if (id === user.id || (target.active !== false && !nextActive) || target.role !== nextRole) clearSession();
      publish(); return Promise.resolve({ ok: true, data: { ...(personas.find(item => item.id === id) as User) } });
    },
    createClosureReason: label => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required.")); const value = label?.trim() ?? "";
      if (!value || value.length > 120) return Promise.resolve(failure("validation", "Reason must be 1–120 characters.")); if (closureReasons.some(item => item.label.toLowerCase() === value.toLowerCase())) return Promise.resolve(failure("conflict", "Reason already exists."));
      const created = { id: `closure-${closureReasons.length + 1}`, label: value, active: true }; closureReasons = [...closureReasons, created]; recordAudit("Closure reason created", created.id, { label: created.label, active: 1 }); publish(); return Promise.resolve({ ok: true, data: { ...created } });
    },
    updateClosureReason: (id, patch) => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required.")); const target = closureReasons.find(item => item.id === id); if (!target) return Promise.resolve(failure("request-failure", "Reason not found."));
      const label = patch.label?.trim() ?? target.label; if (!label || label.length > 120) return Promise.resolve(failure("validation", "Reason must be 1–120 characters.")); if (closureReasons.some(item => item.id !== id && item.label.toLowerCase() === label.toLowerCase())) return Promise.resolve(failure("conflict", "Reason already exists.")); closureReasons = closureReasons.map(item => item.id === id ? { ...item, ...patch, label } : item); recordAudit("Closure reason changed", id, { beforeLabel: target.label, afterLabel: label, active: patch.active === false ? 0 : 1 }); publish(); return Promise.resolve({ ok: true, data: { ...(closureReasons.find(item => item.id === id) as ClosureReason) } });
    },
    importWorkbook: input => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required."));
      if (!input.name.toLowerCase().endsWith(".xlsx")) return Promise.resolve(failure("validation", "Choose an .xlsx workbook."));
      if (input.size > 10_485_760) return Promise.resolve(failure("validation", "Workbook must be 10 MiB or smaller."));
      const errors = input.name.toLowerCase().includes("mixed") ? [{ row: 4, field: "bcn", reason: "BCN must be text." }] : [];
      const result: ImportResult = { jobId: `import-${nextRecord++}`, filename: input.name, completedAt: now(), status: errors.length ? "Partial" : "Completed", processed: errors.length ? 3 : 0, created: errors.length ? 1 : 0, updated: errors.length ? 1 : 0, errorRows: errors.length, errors };
      if (errors.length) { recordAudit("Import completed", result.jobId, { processed: result.processed, errors: result.errorRows }); const existing = customers.find(item => item.bcn === "000123"); if (existing) existing.source.customer_name = "Acme North (imported)"; customers.push({ bcn: "009999", mbcn: "M-09999", name: "Imported Customer", ownerId: null, ownerName: null, status: "Open", previouslyContacted: null, recent: false, propensityTier: null, propensityRank: null, propensityScore: null, phones: [], nextFollowUp: null, contactStatus: "No recorded interaction", source: { bcn: "009999", MBCN: "M-09999", customer_name: "Imported Customer" }, histories: [], followUps: [], closure: undefined }); publish(); }
      return Promise.resolve({ ok: true, data: result });
    },
    assignCustomer: (bcn, ownerId) => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required.")); const customer = customers.find(item => item.bcn === bcn); if (!customer) return Promise.resolve(failure("request-failure", "Customer not found.")); if (ownerId && !personas.some(item => item.id === ownerId && item.role === "Sales" && item.active !== false)) return Promise.resolve(failure("validation", "Choose an active Sales user or Unassigned.")); const oldOwner = customer.ownerId; if (oldOwner === ownerId) return Promise.resolve({ ok: true, data: { bcn, oldOwner, newOwner: ownerId, reason: "No change" } }); const owner = personas.find(item => item.id === ownerId); customer.ownerId = ownerId; customer.ownerName = owner?.name ?? null; customer.histories.push({ id: `assignment-${nextRecord++}`, kind: "Assignment", actor: user.name, actorId: user.id, timestamp: now(), text: `${oldOwner ?? "Unassigned"} → ${owner?.name ?? "Unassigned"}`, before: { ownerId: oldOwner }, after: { ownerId } }); publish(); return Promise.resolve({ ok: true, data: { bcn, oldOwner, newOwner: ownerId, reason: "Manual assignment" } });
    },
    assignmentRules: () => user?.role === "Admin" ? Promise.resolve({ ok: true, data: assignmentRules.map(rule => ({ ...rule, eligibleSalesIds: [...rule.eligibleSalesIds] })) }) : Promise.resolve(failure("forbidden", "Admin access required.")),
    assignmentVersion: () => user?.role === "Admin" ? Promise.resolve({ ok: true, data: assignmentVersion }) : Promise.resolve(failure("forbidden", "Admin access required.")),
    reports: (start, end) => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required.")); const from = start ?? now().slice(0, 10), to = end ?? from; if (from > to) return Promise.resolve(failure("validation", "Start date must not be after end date.")); const owners = new Map<string | null, ReportData["owners"][number]>(); const get = (id: string | null, name: string) => { const row = owners.get(id) ?? { ownerId: id, owner: name, open: 0, closed: 0, neverContacted: 0, attempts: 0, contacts: 0, contactRate: null, pendingFollowUps: 0 }; owners.set(id, row); return row; }; for (const c of customers) { const row = get(c.ownerId, c.ownerName ?? "Unassigned"); if (c.status === "Open") row.open++; else row.closed++; if (c.status === "Open" && !c.previouslyContacted) row.neverContacted++; row.pendingFollowUps += c.status === "Open" ? c.followUps.filter(f => f.status === "Open").length : 0; for (const h of c.histories) if (!h.deleted && h.timestamp.slice(0, 10) >= from && h.timestamp.slice(0, 10) <= to && h.kind === "Interaction") void (h.outcome === "Attempt" ? row.attempts++ : h.outcome === "Contact" && row.contacts++); } owners.forEach(row => { row.contactRate = row.attempts ? Number((row.contacts / row.attempts * 100).toFixed(1)) : null; }); const daily: ReportData["daily"] = []; for (let cursor = new Date(`${from}T00:00:00Z`), stop = new Date(`${to}T00:00:00Z`); cursor <= stop; cursor.setUTCDate(cursor.getUTCDate() + 1)) { const date = cursor.toISOString().slice(0, 10); let attempts = 0, contacts = 0; customers.forEach(c => c.histories.forEach(h => { if (!h.deleted && h.kind === "Interaction" && h.timestamp.slice(0, 10) === date) void (h.outcome === "Attempt" ? attempts++ : h.outcome === "Contact" && contacts++); })); daily.push({ date, attempts, contacts }); } const closureReasons = new Map<string, { reasonId: string; label: string; count: number }>(); customers.forEach(c => c.histories.filter(h => h.kind === "Closure" && h.timestamp.slice(0, 10) >= from && h.timestamp.slice(0, 10) <= to).forEach(h => { const row = closureReasons.get(h.reasonId ?? "unknown") ?? { reasonId: h.reasonId ?? "unknown", label: h.reason ?? "Unknown", count: 0 }; row.count++; closureReasons.set(row.reasonId, row); })); const utcToday = now().slice(0, 10); let overdue = 0, todayCount = 0, undated = 0, completed = 0; customers.forEach(c => { if (c.status === "Closed") return; c.followUps.forEach(f => { if (f.status === "Completed") completed++; if (f.status !== "Open") return; if (f.dueKind === "none") undated++; else if ((f.due ?? "") < utcToday) overdue++; else if ((f.due ?? "").slice(0, 10) === utcToday) todayCount++; }); }); return Promise.resolve({ ok: true, data: { owners: [...owners.values()], daily, closureReasons: [...closureReasons.values()], followUps: { overdue, today: todayCount, undated, completed } } });
    },
    audit: () => { if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required.")); const events: AuditEvent[] = [...auditEvents, ...customers.flatMap(c => c.histories.filter(h => ["Assignment", "Closure", "Reopen", "Interaction", "Standalone note"].includes(h.kind)).map(h => ({ id: h.id, actor: h.actor, actorId: h.actorId ?? "", action: h.kind, target: c.bcn, timestamp: h.timestamp, details: { text: h.deleted ? null : h.text } })))] .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)); return Promise.resolve({ ok: true, data: events }); },
    assignmentFallback: () => user?.role === "Admin" ? Promise.resolve({ ok: true, data: [...fallbackSalesIds].filter(id => personas.some(item => item.id === id && item.role === "Sales" && item.active !== false)) }) : Promise.resolve(failure("forbidden", "Admin access required.")),
    setAssignmentFallback: ids => { if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required.")); const valid = [...new Set(ids)].filter(id => personas.some(item => item.id === id && item.role === "Sales" && item.active !== false)); if (!valid.length) return Promise.resolve(failure("validation", "Choose at least one active Sales user.")); fallbackSalesIds = valid; assignmentVersion++; recordAudit("Assignment fallback changed", "fallback", { members: valid.join(",") }); publish(); return Promise.resolve({ ok: true, data: [...valid] }); },
    createAssignmentRule: input => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required.")); const name = input.name.trim(); if (!name || name.length > 120 || !input.eligibleSalesIds.length) return Promise.resolve(failure("validation", "Rule name and eligible Sales are required.")); if (assignmentRules.some(rule => rule.name.toLowerCase() === name.toLowerCase())) return Promise.resolve(failure("conflict", "Rule name already exists.")); const rule = { ...input, id: `rule-${assignmentRules.length + 1}`, name, position: assignmentRules.length + 1, eligibleSalesIds: [...input.eligibleSalesIds] }; assignmentRules = [...assignmentRules, rule]; assignmentVersion++; recordAudit("Assignment rule created", rule.id, { name: rule.name, active: 1 }); publish(); return Promise.resolve({ ok: true, data: { ...rule } });
    },
    updateAssignmentRule: (id, patch) => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required.")); const current = assignmentRules.find(rule => rule.id === id); if (!current) return Promise.resolve(failure("request-failure", "Rule not found.")); const name = patch.name?.trim() ?? current.name; if (!name || name.length > 120 || (patch.eligibleSalesIds && !patch.eligibleSalesIds.length)) return Promise.resolve(failure("validation", "Rule name and eligible Sales are required.")); if (assignmentRules.some(rule => rule.id !== id && rule.name.toLowerCase() === name.toLowerCase())) return Promise.resolve(failure("conflict", "Rule name already exists.")); assignmentRules = assignmentRules.map(rule => rule.id === id ? { ...rule, ...patch, name, eligibleSalesIds: patch.eligibleSalesIds ?? rule.eligibleSalesIds } : rule).sort((a, b) => a.position - b.position).map((rule, index) => ({ ...rule, position: index + 1 })); assignmentVersion++; publish(); return Promise.resolve({ ok: true, data: { ...(assignmentRules.find(rule => rule.id === id) as AssignmentRule) } });
    },
    runAssignments: input => {
      if (!user || user.role !== "Admin") return Promise.resolve(failure("forbidden", "Admin access required.")); if (failNext) { failNext = false; return Promise.resolve(failure("request-failure", "The mock request failed. Please retry.")); } if (input.expectedVersion !== undefined && input.expectedVersion !== assignmentVersion) return Promise.resolve(failure("conflict", "Assignment configuration changed. Reload before running.")); if (input.scope === "selected" && !input.selectedBcns?.length) return Promise.resolve(failure("validation", "Select at least one customer.")); const key = `${user.id}:${input.submissionId ?? "run"}`; const previous = assignmentSubmissions.get(key); if (previous) return Promise.resolve({ ok: true, data: previous }); const selected = new Set(input.selectedBcns ?? []); const candidates = customers.filter(customer => customer.status === "Open" && (input.scope === "all" || (input.scope === "selected" ? selected.has(customer.bcn) : !customer.ownerId))).sort((a, b) => a.bcn.localeCompare(b.bcn)); const counts = new Map(personas.filter(item => item.role === "Sales" && item.active !== false).map(item => [item.id, customers.filter(customer => customer.status === "Open" && customer.ownerId === item.id).length])); const results: import("./types").AssignmentResult[] = []; for (const customer of candidates) { const rule = assignmentRules.filter(item => item.active).sort((a, b) => a.position - b.position).find(item => { const actual = item.field in customer ? (customer as unknown as Record<string, unknown>)[item.field] : customer.source[item.field]; if (item.operator === "is-null") return actual == null || actual === ""; if (item.operator === "is-not-null") return actual != null && actual !== ""; if (actual == null || actual === "") return false; const left = String(actual).trim().toLowerCase(), right = item.value.trim().toLowerCase(); if (item.operator === "=") return left === right; if (item.operator === "!=") return left !== right; if (item.operator === "contains") return left.includes(right); if (item.operator === "in") return item.value.split(",").map(value => value.trim().toLowerCase()).includes(left); const numberLeft = Number(actual), numberRight = Number(item.value); if (item.operator === "<") return numberLeft < numberRight; if (item.operator === "<=") return numberLeft <= numberRight; if (item.operator === ">") return numberLeft > numberRight; if (item.operator === ">=") return numberLeft >= numberRight; if (item.operator === "between") { const [low, high] = item.value.split(",").map(Number); return numberLeft >= low && numberLeft <= high; } return false; }); const eligible = (rule?.eligibleSalesIds ?? fallbackSalesIds).filter(id => counts.has(id)); if (!eligible.length) { results.push({ bcn: customer.bcn, oldOwner: customer.ownerId, newOwner: customer.ownerId, reason: "No eligible salesperson" }); continue; } const newOwner = [...eligible].sort((a, b) => (counts.get(a)! - counts.get(b)!) || a.localeCompare(b))[0]; const oldOwner = customer.ownerId; if (oldOwner === newOwner) results.push({ bcn: customer.bcn, oldOwner, newOwner, reason: rule?.name ?? "Fallback" }); else { customer.ownerId = newOwner; customer.ownerName = personas.find(item => item.id === newOwner)?.name ?? null; counts.set(newOwner, (counts.get(newOwner) ?? 0) + 1); customer.histories.push({ id: `assignment-${nextRecord++}`, kind: "Assignment", actor: user.name, actorId: user.id, timestamp: now(), text: `${oldOwner ?? "Unassigned"} → ${customer.ownerName}`, before: { ownerId: oldOwner }, after: { ownerId: newOwner } }); results.push({ bcn: customer.bcn, oldOwner, newOwner, reason: rule?.name ?? "Fallback" }); } } const summary = { scanned: results.length, assigned: results.filter(item => !item.oldOwner && item.newOwner).length, reassigned: results.filter(item => !!item.oldOwner && item.oldOwner !== item.newOwner).length, unchanged: results.filter(item => item.oldOwner === item.newOwner).length, skipped: results.filter(item => item.reason === "No eligible salesperson").length, results }; assignmentSubmissions.set(key, summary); publish(); return Promise.resolve({ ok: true, data: summary });
    },
    deleteHistory: (bcn, recordId) => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => deleteHistory(bcn, recordId));
    },
    subscribeSession: listener => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener); }; },
  };
  const controls: MockControls = {
    personas,
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setScenario: scenario => {
      failNext = scenario === "Error";
      snapshot = { ...snapshot, scenario, notice: "" };
      if (scenario === "Expired session") {
        clearSession();
        snapshot = { ...snapshot, notice: "Your session expired. Sign in again." };
      }
      if (scenario !== "Loading") wake();
      publish();
    },
    reset: () => { clearSession(); personas = seedUsers.map(user => ({ ...user })); closureReasons = seedReasons.map(reason => ({ ...reason })); assignmentRules = seedRules(); fallbackSalesIds = ["sales-river", "sales-sky"]; assignmentVersion = 1; auditEvents.length = 0; records = fixtures(); customers = customerFixtures.map(cloneCustomer); submissions.clear(); followUpSubmissions.clear(); lifecycleSubmissions.clear(); assignmentSubmissions.clear(); nextRecord = 1; failNext = false; snapshot = { scenario: "Normal", revision: snapshot.revision, reset: snapshot.reset + 1, notice: "" }; publish(); },
  };
  function actorAllowed(customer: CustomerDetail) { return Boolean(user && (user.role === "Admin" || customer.ownerId === user.id)); }
  function validateText(value: string | null | undefined, field: string, required: boolean) {
    if (required && !value?.trim()) return failure<string>("validation", `${field} is required.`);
    if (value && value.trim().length > 4000) return failure<string>("validation", `${field} must be 4,000 characters or fewer.`);
    return { ok: true as const, data: value?.trim() ?? "" };
  }
  function validateFollowUp(input: { type: FollowUpInput["type"]; due?: string | null; dueKind?: FollowUpInput["dueKind"] }, existing?: FollowUp): Result<{ due: string | null; dueKind: "date" | "datetime" | "none" }> {
    const dueKind = input.dueKind ?? (input.due ? (input.due.includes("T") ? "datetime" : "date") : "none");
    const due = input.due?.trim() || null;
    if (input.type === "Follow-up needed" && (due || dueKind !== "none")) return failure<{ due: string | null; dueKind: "date" | "datetime" | "none" }>("validation", "Follow-up needed cannot have a date.");
    if (input.type === "Appointment" && dueKind !== "datetime") return failure<{ due: string | null; dueKind: "date" | "datetime" | "none" }>("validation", "Appointments require a UTC date and time.");
    if (input.type === "Reminder" && dueKind === "none") return failure<{ due: string | null; dueKind: "date" | "datetime" | "none" }>("validation", "Reminders require a UTC date or time.");
    if (dueKind === "none") return { ok: true as const, data: { due: null, dueKind } };
    if (!due || (dueKind === "date" ? !/^\d{4}-\d{2}-\d{2}$/.test(due) : !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(due))) return failure("validation", "Enter a valid UTC date or date/time.");
    const instant = dueKind === "date" ? `${due}T00:00:00.000Z` : due;
    if (Number.isNaN(Date.parse(instant))) return failure("validation", "Enter a valid UTC date or date/time.");
    const today = now().slice(0, 10);
    const unchanged = existing && existing.due === due && existing.dueKind === dueKind;
    if (!unchanged && (dueKind === "date" ? due < today : Date.parse(instant) <= Date.parse(now()))) return failure("validation", "The due value must be today or in the future in UTC.");
    return { ok: true as const, data: { due, dueKind } };
  }
  function refreshNextAction(customer: CustomerDetail) {
    const open = customer.followUps.filter(item => item.status === "Open").sort((a, b) => {
      const ad = a.dueKind === "none" ? Number.POSITIVE_INFINITY : Date.parse(a.dueKind === "date" ? `${a.due}T00:00:00.000Z` : a.due!);
      const bd = b.dueKind === "none" ? Number.POSITIVE_INFINITY : Date.parse(b.dueKind === "date" ? `${b.due}T00:00:00.000Z` : b.due!);
      return ad - bd || a.id.localeCompare(b.id);
    });
    customer.nextFollowUp = open[0]?.due ?? null;
  }
  function createInteraction(input: CreateInteractionInput): Result<HistoryRecord> {
    const customer = customers.find(item => item.bcn === input.bcn);
    if (!customer) return failure("request-failure", "Customer not found.");
    if (!actorAllowed(customer)) return failure("forbidden", "You can only work on customers you own.");
    if (customer.status === "Closed") return failure("forbidden", "Reopen this customer before recording an interaction.");
    if (input.outcome !== "Attempt" && input.outcome !== "Contact") return failure("validation", "Outcome must be Attempt or Contact.");
    const text = validateText(input.note, "Interaction note", false); if (!text.ok) return text;
    const followUp = input.followUp ? validateFollowUp(input.followUp) : null;
    if (followUp && !followUp.ok) return followUp;
    if (input.followUp) { const followUpNote = validateText(input.followUp.note, "Follow-up note", false); if (!followUpNote.ok) return followUpNote; }
    const submissionId = input.submissionId?.trim() || `submission-${nextRecord}`;
    const previous = submissions.get(`${user!.id}:${input.bcn}:${submissionId}`); if (previous) return { ok: true, data: { ...previous } };
    const record: HistoryRecord = { id: `interaction-${nextRecord++}`, kind: "Interaction", actor: user!.name, actorId: user!.id, timestamp: now(), text: text.data || null, outcome: input.outcome, ...(text.data ? { attachedNoteId: `attached-note-${nextRecord - 1}` } : {}) };
    customer.histories.push(record); customer.contactStatus = input.outcome; customer.previouslyContacted = true; submissions.set(`${user!.id}:${input.bcn}:${submissionId}`, record);
    if (input.followUp && followUp?.ok) {
      const item: FollowUp = { id: `follow-up-${nextRecord++}`, bcn: input.bcn, type: input.followUp!.type, ...followUp.data, note: input.followUp!.note?.trim() || null, status: "Open", actor: user!.name, actorId: user!.id, createdAt: record.timestamp, updatedAt: record.timestamp, interactionId: record.id };
      customer.followUps.push(item); record.followUpId = item.id; refreshNextAction(customer);
      customer.histories.push({ id: `follow-up-created-${item.id}`, kind: "Follow-up", actor: user!.name, actorId: user!.id, timestamp: record.timestamp, text: item.note, followUpId: item.id, followUpStatus: "Open", interactionId: record.id });
    }
    return { ok: true, data: { ...record } };
  }
  function createNote(input: CreateNoteInput): Result<HistoryRecord> {
    const customer = customers.find(item => item.bcn === input.bcn);
    if (!customer) return failure("request-failure", "Customer not found.");
    if (!actorAllowed(customer)) return failure("forbidden", "You can only work on customers you own.");
    if (customer.status === "Closed") return failure("forbidden", "Reopen this customer before adding a note.");
    const text = validateText(input.text, "Note", true); if (!text.ok) return text;
    const submissionId = input.submissionId?.trim() || `submission-${nextRecord}`;
    const previous = submissions.get(`${user!.id}:${input.bcn}:${submissionId}`); if (previous) return { ok: true, data: { ...previous } };
    const record: HistoryRecord = { id: `note-${nextRecord++}`, kind: "Standalone note", actor: user!.name, actorId: user!.id, timestamp: now(), text: text.data };
    customer.histories.push(record); submissions.set(`${user!.id}:${input.bcn}:${submissionId}`, record);
    return { ok: true, data: { ...record } };
  }
  function createFollowUp(input: FollowUpInput): Result<FollowUp> {
    const customer = customers.find(item => item.bcn === input.bcn); if (!customer) return failure("request-failure", "Customer not found.");
    if (!actorAllowed(customer)) return failure("forbidden", "You can only work on customers you own.");
    if (customer.status === "Closed") return failure("conflict", "Reopen this customer before adding a follow-up.");
    const due = validateFollowUp(input); if (!due.ok) return due;
    const note = validateText(input.note, "Follow-up note", false); if (!note.ok) return note;
    const key = `${user!.id}:${input.bcn}:${input.submissionId?.trim() || `submission-${nextRecord}`}`;
    const previous = followUpSubmissions.get(key); if (previous) return { ok: true, data: { ...previous } };
    const timestamp = now(); const item: FollowUp = { id: `follow-up-${nextRecord++}`, bcn: input.bcn, type: input.type, ...due.data, note: note.data || null, status: "Open", actor: user!.name, actorId: user!.id, createdAt: timestamp, updatedAt: timestamp, ...(input.interactionId ? { interactionId: input.interactionId } : {}) };
    customer.followUps.push(item); customer.histories.push({ id: `follow-up-created-${item.id}`, kind: "Follow-up", actor: user!.name, actorId: user!.id, timestamp, text: item.note, followUpId: item.id, followUpStatus: "Open", ...(item.interactionId ? { interactionId: item.interactionId } : {}) }); refreshNextAction(customer); followUpSubmissions.set(key, item); return { ok: true, data: { ...item } };
  }
  function updateFollowUp(input: UpdateFollowUpInput): Result<FollowUp> {
    const customer = customers.find(item => item.bcn === input.bcn); if (!customer) return failure("request-failure", "Customer not found.");
    if (!actorAllowed(customer)) return failure("forbidden", "You can only work on customers you own.");
    const item = customer.followUps.find(value => value.id === input.followUpId); if (!item) return failure("request-failure", "Follow-up not found.");
    if (input.expectedUpdatedAt && item.updatedAt !== input.expectedUpdatedAt) return failure("conflict", "This follow-up changed. Reload before saving.");
    if (item.status !== "Open") return failure("conflict", `Follow-up is already ${item.status.toLowerCase()}.`);
    const due = validateFollowUp(input, item); if (!due.ok) return due; const note = validateText(input.note, "Follow-up note", false); if (!note.ok) return note;
    const key = `${user!.id}:${input.bcn}:${input.followUpId}:${input.submissionId?.trim() || `submission-${nextRecord}`}`; const previous = followUpSubmissions.get(key); if (previous) return { ok: true, data: { ...previous } };
    const before = { type: item.type, due: item.due, dueKind: item.dueKind, note: item.note }; const timestamp = now(); Object.assign(item, { type: input.type, ...due.data, note: note.data || null, updatedAt: timestamp }); customer.histories.push({ id: `follow-up-edit-${nextRecord++}`, kind: "Follow-up edited", actor: user!.name, actorId: user!.id, timestamp, text: item.note, followUpId: item.id, before, after: { type: item.type, due: item.due, dueKind: item.dueKind, note: item.note }, followUpStatus: item.status }); refreshNextAction(customer); followUpSubmissions.set(key, item); return { ok: true, data: { ...item } };
  }
  function cancelFollowUp(bcn: string, followUpId: string, submissionId?: string): Result<FollowUp> {
    const customer = customers.find(item => item.bcn === bcn); if (!customer) return failure("request-failure", "Customer not found.");
    if (!actorAllowed(customer)) return failure("forbidden", "You can only work on customers you own."); const item = customer.followUps.find(value => value.id === followUpId); if (!item) return failure("request-failure", "Follow-up not found.");
    const key = `${user!.id}:${bcn}:${followUpId}:cancel:${submissionId?.trim() || `submission-${nextRecord}`}`; const previous = followUpSubmissions.get(key); if (previous) return { ok: true, data: { ...previous } }; if (item.status !== "Open") return failure("conflict", `Follow-up is already ${item.status.toLowerCase()}.`);
    const timestamp = now(); item.status = "Cancelled"; item.updatedAt = timestamp; item.cancelledAt = timestamp; item.cancelledBy = user!.name; customer.histories.push({ id: `follow-up-cancel-${nextRecord++}`, kind: "Follow-up cancelled", actor: user!.name, actorId: user!.id, timestamp, text: item.note, followUpId: item.id, followUpStatus: "Cancelled" }); refreshNextAction(customer); followUpSubmissions.set(key, item); return { ok: true, data: { ...item } };
  }
  function completeFollowUp(input: CompleteFollowUpInput): Result<FollowUp> {
    const customer = customers.find(item => item.bcn === input.bcn); if (!customer) return failure("request-failure", "Customer not found."); if (!actorAllowed(customer)) return failure("forbidden", "You can only work on customers you own."); const item = customer.followUps.find(value => value.id === input.followUpId); if (!item) return failure("request-failure", "Follow-up not found.");
    const key = `${user!.id}:${input.bcn}:${input.followUpId}:complete:${input.submissionId?.trim() || `submission-${nextRecord}`}`; const previous = followUpSubmissions.get(key); if (previous) return { ok: true, data: { ...previous } }; if (item.status !== "Open") return failure("conflict", `Follow-up is already ${item.status.toLowerCase()}.`); if (input.outcome !== "Attempt" && input.outcome !== "Contact") return failure("validation", "Outcome must be Attempt or Contact."); const note = validateText(input.note, "Completion note", false); if (!note.ok) return note;
    const timestamp = now(); const interaction: HistoryRecord = { id: `interaction-${nextRecord++}`, kind: "Interaction", actor: user!.name, actorId: user!.id, timestamp, text: note.data || null, outcome: input.outcome, interactionId: item.interactionId, followUpId: item.id }; customer.histories.push(interaction); customer.contactStatus = input.outcome; customer.previouslyContacted = true; item.status = "Completed"; item.updatedAt = timestamp; customer.histories.push({ id: `follow-up-complete-${nextRecord++}`, kind: "Follow-up completed", actor: user!.name, actorId: user!.id, timestamp, text: note.data || null, followUpId: item.id, followUpStatus: "Completed", interactionId: interaction.id }); refreshNextAction(customer); followUpSubmissions.set(key, item); return { ok: true, data: { ...item } };
  }
  function closeCustomer(input: LifecycleInput): Result<Customer> {
    const customer = customers.find(item => item.bcn === input.bcn); if (!customer) return failure("request-failure", "Customer not found."); if (!actorAllowed(customer)) return failure("forbidden", "You can only manage customers you own."); const key = `${user!.id}:${input.bcn}:close:${input.submissionId?.trim() || `submission-${nextRecord}`}`; const previous = lifecycleSubmissions.get(key); if (previous) return { ok: true, data: { ...previous } }; if (input.expectedStatus && customer.status !== input.expectedStatus) return failure("conflict", "Customer state changed. Reload before saving."); if (customer.status === "Closed") return failure("conflict", "Customer is already closed."); const reason = closureReasons.find(value => value.id === input.reasonId && value.active); if (!reason) return failure("validation", "Choose an active closure reason.");
    const timestamp = now(); customer.status = "Closed"; customer.closure = { reasonId: reason.id, reason: reason.label, actor: user!.name, actorId: user!.id, timestamp }; const open = customer.followUps.filter(item => item.status === "Open"); open.forEach(item => { item.status = "Cancelled"; item.updatedAt = timestamp; item.cancelledAt = timestamp; item.cancelledBy = user!.name; customer.histories.push({ id: `follow-up-cancel-${nextRecord++}`, kind: "Follow-up cancelled", actor: user!.name, actorId: user!.id, timestamp, text: "Customer closed", followUpId: item.id, followUpStatus: "Cancelled" }); }); customer.histories.push({ id: `closure-${nextRecord++}`, kind: "Closure", actor: user!.name, actorId: user!.id, timestamp, text: reason.label, reasonId: reason.id }); refreshNextAction(customer); const result = { ...customer }; lifecycleSubmissions.set(key, result); return { ok: true, data: { ...result } };
  }
  function reopenCustomer(input: LifecycleInput): Result<Customer> {
    const customer = customers.find(item => item.bcn === input.bcn); if (!customer) return failure("request-failure", "Customer not found."); if (!user || user.role !== "Admin" && customer.ownerId !== user.id) return failure("forbidden", "You can only manage customers you own."); const key = `${user.id}:${input.bcn}:reopen:${input.submissionId?.trim() || `submission-${nextRecord}`}`; const previous = lifecycleSubmissions.get(key); if (previous) return { ok: true, data: { ...previous } }; if (input.expectedStatus && customer.status !== input.expectedStatus) return failure("conflict", "Customer state changed. Reload before saving."); if (customer.status === "Open") return failure("conflict", "Customer is already open."); const timestamp = now(); customer.status = "Open"; if (customer.ownerId && !personas.some(persona => persona.id === customer.ownerId && persona.role === "Sales")) { const oldOwner = customer.ownerName; customer.ownerId = null; customer.ownerName = null; customer.histories.push({ id: `assignment-${nextRecord++}`, kind: "Assignment", actor: user.name, actorId: user.id, timestamp, text: `Cleared inactive owner ${oldOwner ?? ""}`.trim() }); } customer.histories.push({ id: `reopen-${nextRecord++}`, kind: "Reopen", actor: user.name, actorId: user.id, timestamp, text: customer.closure?.reason ?? null }); refreshNextAction(customer); const result = { ...customer }; lifecycleSubmissions.set(key, result); return { ok: true, data: { ...result } };
  }
  function deleteHistory(bcn: string, recordId: string): Result<HistoryRecord> {
    const customer = customers.find(item => item.bcn === bcn); if (!customer) return failure("request-failure", "Customer not found.");
    if (!user || !(user.role === "Admin" || customer.ownerId === user.id)) return failure("forbidden", "You can only delete records on customers you own.");
    const record = customer.histories.find(item => item.id === recordId); if (!record) return failure("request-failure", "Record not found.");
    if (record.kind !== "Interaction" && record.kind !== "Standalone note") return failure("forbidden", "Only interactions and standalone notes can be deleted.");
    if (record.deleted) return { ok: true, data: { ...record } };
    record.deleted = true; record.deletedAt = now(); record.deletedBy = user.name; record.deletedById = user.id; record.customerBcn = bcn; record.targetId = recordId; record.text = null; delete record.outcome;
    if (record.kind === "Interaction") customer.contactStatus = [...customer.histories].filter(item => item.kind === "Interaction" && !item.deleted).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.outcome ?? "No recorded interaction";
    return { ok: true, data: { ...record } };
  }
  return { services, controls };
}
