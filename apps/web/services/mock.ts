import type { CustomerDetail, MockControls, MockSnapshot, Result, SampleRecord, Services, User } from "./types";

const personas: readonly User[] = [
  { id: "admin-demo", name: "Alex Admin", role: "Admin" },
  { id: "sales-river", name: "River Sales", role: "Sales" },
  { id: "sales-sky", name: "Sky Sales", role: "Sales" },
];
const failure = <T>(code: "unauthenticated" | "forbidden" | "request-failure", message: string): Result<T> => ({ ok: false, error: { code, message } });
const customerFixtures: CustomerDetail[] = [
  { bcn: "000123", mbcn: "M-00123", name: "Acme North", ownerId: "sales-river", ownerName: "River Sales", status: "Open", previouslyContacted: false, recent: true, propensityTier: "A", propensityRank: 1, propensityScore: 0.98, phones: ["(555) 010-0101", "555-010-0102"], nextFollowUp: "2026-09-12", contactStatus: "No recorded interaction", source: { bcn: "000123", MBCN: "M-00123", customer_name: "Acme North", phone: "(555) 010-0101", previously_contacted: false, propensity_score: 0.98, propensity_tier: "A", propensity_rank: 1, Inside_Lead: "Lead A", Field_Rep: null, SC_Naming: "SC-1", Inside_Rep: "River Sales", Branch_Code: "001", RSM_Name: "RSM North", Originating_BU: "North", LAST_PURCHASE_DATE: null, recent: true, REVENUE_AMOUNT_2024: 1000, REVENUE_AMOUNT_2025: null, REVENUE_AMOUNT_2026: 1200, FEM_AMOUNT_2024: null, FEM_AMOUNT_2025: null, FEM_AMOUNT_2026: null, Payment_Terms: "Net 30", vendor_1: null, vendor_1_revenue: null, vendor_2: null, vendor_2_revenue: null, vendor_3: null, vendor_3_revenue: null, category_1: "Industrial", category_1_revenue: 1200, category_2: null, category_2_revenue: null, category_3: null, category_3_revenue: null }, histories: [] },
  { bcn: "000124", mbcn: "M-00124", name: "Acme North", ownerId: "sales-sky", ownerName: "Sky Sales", status: "Closed", previouslyContacted: true, recent: false, propensityTier: "B", propensityRank: 2, propensityScore: 0.7, phones: ["555 010 0103"], nextFollowUp: null, contactStatus: "Contact", source: { bcn: "000124", MBCN: "M-00124", customer_name: "Acme North", phone: "555 010 0103", previously_contacted: true, propensity_score: 0.7, propensity_tier: "B", propensity_rank: 2, Inside_Lead: null, Field_Rep: "Rep B", SC_Naming: null, Inside_Rep: "Sky Sales", Branch_Code: "002", RSM_Name: null, Originating_BU: "West", LAST_PURCHASE_DATE: "2026-01-04", recent: false, REVENUE_AMOUNT_2024: 200, REVENUE_AMOUNT_2025: 300, REVENUE_AMOUNT_2026: 400, FEM_AMOUNT_2024: null, FEM_AMOUNT_2025: null, FEM_AMOUNT_2026: null, Payment_Terms: null, vendor_1: "Vendor", vendor_1_revenue: 20, vendor_2: null, vendor_2_revenue: null, vendor_3: null, vendor_3_revenue: null, category_1: null, category_1_revenue: null, category_2: null, category_2_revenue: null, category_3: null, category_3_revenue: null }, histories: Array.from({ length: 30 }, (_, i) => ({ kind: "Interaction", id: `i-${i + 1}`, actor: "Sky Sales", timestamp: `2026-08-${String((i % 9) + 1).padStart(2, "0")}T10:00:00Z`, text: i % 2 ? "Attempt" : "Contact" })) },
  { bcn: "000125", mbcn: "M-00125", name: "Beta Works", ownerId: null, ownerName: null, status: "Open", previouslyContacted: false, recent: false, propensityTier: null, propensityRank: null, propensityScore: null, phones: [], nextFollowUp: null, contactStatus: "Attempt", source: { bcn: "000125", MBCN: "M-00125", customer_name: "Beta Works", phone: null, previously_contacted: false, propensity_score: null, propensity_tier: null, propensity_rank: null, Inside_Lead: null, Field_Rep: null, SC_Naming: null, Inside_Rep: null, Branch_Code: null, RSM_Name: null, Originating_BU: null, LAST_PURCHASE_DATE: null, recent: false, REVENUE_AMOUNT_2024: null, REVENUE_AMOUNT_2025: null, REVENUE_AMOUNT_2026: null, FEM_AMOUNT_2024: null, FEM_AMOUNT_2025: null, FEM_AMOUNT_2026: null, Payment_Terms: null, vendor_1: null, vendor_1_revenue: null, vendor_2: null, vendor_2_revenue: null, vendor_3: null, vendor_3_revenue: null, category_1: null, category_1_revenue: null, category_2: null, category_2_revenue: null, category_3: null, category_3_revenue: null }, histories: [] },
];

export function createMockAdapter(): { services: Services; controls: MockControls } {
  let user: User | null = null;
  let generation = 0;
  let failNext = false;
  let snapshot: MockSnapshot = { scenario: "Normal", revision: 0, reset: 0, notice: "" };
  const fixtures = () => Object.fromEntries(personas.map(persona => [persona.id, [{ id: `${persona.id}-sample`, label: `${persona.name}'s synthetic service record` }]]));
  let records: Record<string, SampleRecord[]> = fixtures();
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
      return request(() => ({ ok: true, data: customerFixtures.map(({ histories, source, ...customer }) => { void histories; void source; return { ...customer }; }) }));
    },
    getCustomer: bcn => {
      if (!user) return Promise.resolve(failure("unauthenticated", "Sign in to continue."));
      return request(() => { const customer = customerFixtures.find(item => item.bcn === bcn); return customer ? { ok: true, data: { ...customer, histories: [...customer.histories] } } : failure("request-failure", "Customer not found."); });
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
    reset: () => { clearSession(); records = fixtures(); failNext = false; snapshot = { scenario: "Normal", revision: snapshot.revision, reset: snapshot.reset + 1, notice: "" }; publish(); },
  };
  return { services, controls };
}
