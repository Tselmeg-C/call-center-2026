import type { CreateInteractionInput, CreateNoteInput, CustomerDetail, HistoryRecord, MockControls, MockSnapshot, Result, SampleRecord, Services, User } from "./types";

const personas: readonly User[] = [
  { id: "admin-demo", name: "Alex Admin", role: "Admin" },
  { id: "sales-river", name: "River Sales", role: "Sales" },
  { id: "sales-sky", name: "Sky Sales", role: "Sales" },
];
const failure = <T>(code: "unauthenticated" | "forbidden" | "request-failure" | "validation", message: string): Result<T> => ({ ok: false, error: { code, message } });
const customerFixtures: CustomerDetail[] = [
  { bcn: "000123", mbcn: "M-00123", name: "Acme North", ownerId: "sales-river", ownerName: "River Sales", status: "Open", previouslyContacted: false, recent: true, propensityTier: "A", propensityRank: 1, propensityScore: 0.98, phones: ["(555) 010-0101", "555-010-0102"], nextFollowUp: "2026-09-12", contactStatus: "No recorded interaction", source: { bcn: "000123", MBCN: "M-00123", customer_name: "Acme North", phone: "(555) 010-0101", previously_contacted: false, propensity_score: 0.98, propensity_tier: "A", propensity_rank: 1, Inside_Lead: "Lead A", Field_Rep: null, SC_Naming: "SC-1", Inside_Rep: "River Sales", Branch_Code: "001", RSM_Name: "RSM North", Originating_BU: "North", LAST_PURCHASE_DATE: null, recent: true, REVENUE_AMOUNT_2024: 1000, REVENUE_AMOUNT_2025: null, REVENUE_AMOUNT_2026: 1200, FEM_AMOUNT_2024: null, FEM_AMOUNT_2025: null, FEM_AMOUNT_2026: null, Payment_Terms: "Net 30", vendor_1: null, vendor_1_revenue: null, vendor_2: null, vendor_2_revenue: null, vendor_3: null, vendor_3_revenue: null, category_1: "Industrial", category_1_revenue: 1200, category_2: null, category_2_revenue: null, category_3: null, category_3_revenue: null }, histories: [] },
  { bcn: "000124", mbcn: "M-00124", name: "Acme North", ownerId: "sales-sky", ownerName: "Sky Sales", status: "Closed", previouslyContacted: true, recent: false, propensityTier: "B", propensityRank: 2, propensityScore: 0.7, phones: ["555 010 0103"], nextFollowUp: null, contactStatus: "Contact", source: { bcn: "000124", MBCN: "M-00124", customer_name: "Acme North", phone: "555 010 0103", previously_contacted: true, propensity_score: 0.7, propensity_tier: "B", propensity_rank: 2, Inside_Lead: null, Field_Rep: "Rep B", SC_Naming: null, Inside_Rep: "Sky Sales", Branch_Code: "002", RSM_Name: null, Originating_BU: "West", LAST_PURCHASE_DATE: "2026-01-04", recent: false, REVENUE_AMOUNT_2024: 200, REVENUE_AMOUNT_2025: 300, REVENUE_AMOUNT_2026: 400, FEM_AMOUNT_2024: null, FEM_AMOUNT_2025: null, FEM_AMOUNT_2026: null, Payment_Terms: null, vendor_1: "Vendor", vendor_1_revenue: 20, vendor_2: null, vendor_2_revenue: null, vendor_3: null, vendor_3_revenue: null, category_1: null, category_1_revenue: null, category_2: null, category_2_revenue: null, category_3: null, category_3_revenue: null }, histories: Array.from({ length: 30 }, (_, i) => ({ kind: ["Interaction", "Standalone note", "Follow-up", "Assignment", "Closure", "Reopen"][i % 6], id: `i-${i + 1}`, actor: "Sky Sales", timestamp: `2026-09-${String(30 - i).padStart(2, "0")}T10:00:00Z`, text: i % 2 ? "Attempt" : "Contact", ...(i === 0 ? { attachedNoteId: "note-fixture-1" } : {}), ...(i === 2 ? { interactionId: "i-1", followUpStatus: "Completed" as const } : {}) })) },
  { bcn: "000125", mbcn: "M-00125", name: "Beta Works", ownerId: null, ownerName: null, status: "Open", previouslyContacted: false, recent: false, propensityTier: null, propensityRank: null, propensityScore: null, phones: [], nextFollowUp: null, contactStatus: "No recorded interaction", source: { bcn: "000125", MBCN: "M-00125", customer_name: "Beta Works", phone: null, previously_contacted: false, propensity_score: null, propensity_tier: null, propensity_rank: null, Inside_Lead: null, Field_Rep: null, SC_Naming: null, Inside_Rep: null, Branch_Code: null, RSM_Name: null, Originating_BU: null, LAST_PURCHASE_DATE: null, recent: false, REVENUE_AMOUNT_2024: null, REVENUE_AMOUNT_2025: null, REVENUE_AMOUNT_2026: null, FEM_AMOUNT_2024: null, FEM_AMOUNT_2025: null, FEM_AMOUNT_2026: null, Payment_Terms: null, vendor_1: null, vendor_1_revenue: null, vendor_2: null, vendor_2_revenue: null, vendor_3: null, vendor_3_revenue: null, category_1: null, category_1_revenue: null, category_2: null, category_2_revenue: null, category_3: null, category_3_revenue: null }, histories: [] },
];

export function createMockAdapter(options: { now?: () => string } = {}): { services: Services; controls: MockControls } {
  let user: User | null = null;
  let generation = 0;
  let failNext = false;
  let snapshot: MockSnapshot = { scenario: "Normal", revision: 0, reset: 0, notice: "" };
  const fixtures = () => Object.fromEntries(personas.map(persona => [persona.id, [{ id: `${persona.id}-sample`, label: `${persona.name}'s synthetic service record` }]]));
  let records: Record<string, SampleRecord[]> = fixtures();
  let customers = customerFixtures.map(customer => ({ ...customer, histories: customer.histories.map(history => ({ ...history })) }));
  let nextRecord = 1;
  const submissions = new Map<string, HistoryRecord>();
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
      const selected = personas.find(persona => persona.id === id);
      if (!selected) return failure("forbidden", "Choose a valid mock persona.");
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
    getCustomer: bcn => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => { const customer = customers.find(item => item.bcn === bcn); return customer ? { ok: true, data: { ...customer, histories: [...customer.histories].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)) } } : failure("request-failure", "Customer not found."); });
    },
    createInteraction: input => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => createInteraction(input));
    },
    createNote: input => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => createNote(input));
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
    reset: () => { clearSession(); records = fixtures(); customers = customerFixtures.map(customer => ({ ...customer, histories: customer.histories.map(history => ({ ...history })) })); submissions.clear(); nextRecord = 1; failNext = false; snapshot = { scenario: "Normal", revision: snapshot.revision, reset: snapshot.reset + 1, notice: "" }; publish(); },
  };
  function actorAllowed(customer: CustomerDetail) { return Boolean(user && (user.role === "Admin" || customer.ownerId === user.id)); }
  function validateText(value: string | null | undefined, field: string, required: boolean) {
    if (required && !value?.trim()) return failure<string>("validation", `${field} is required.`);
    if (value && value.trim().length > 4000) return failure<string>("validation", `${field} must be 4,000 characters or fewer.`);
    return { ok: true as const, data: value?.trim() ?? "" };
  }
  function createInteraction(input: CreateInteractionInput): Result<HistoryRecord> {
    const customer = customers.find(item => item.bcn === input.bcn);
    if (!customer) return failure("request-failure", "Customer not found.");
    if (!actorAllowed(customer)) return failure("forbidden", "You can only work on customers you own.");
    if (customer.status === "Closed") return failure("forbidden", "Reopen this customer before recording an interaction.");
    if (input.outcome !== "Attempt" && input.outcome !== "Contact") return failure("validation", "Outcome must be Attempt or Contact.");
    const text = validateText(input.note, "Interaction note", false); if (!text.ok) return text;
    const submissionId = input.submissionId?.trim() || `submission-${nextRecord}`;
    const previous = submissions.get(`${user!.id}:${input.bcn}:${submissionId}`); if (previous) return { ok: true, data: { ...previous } };
    const record: HistoryRecord = { id: `interaction-${nextRecord++}`, kind: "Interaction", actor: user!.name, actorId: user!.id, timestamp: now(), text: text.data || null, outcome: input.outcome, ...(text.data ? { attachedNoteId: `attached-note-${nextRecord - 1}` } : {}) };
    customer.histories.push(record); customer.contactStatus = input.outcome; customer.previouslyContacted = true; submissions.set(`${user!.id}:${input.bcn}:${submissionId}`, record);
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
