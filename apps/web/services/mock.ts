import type { MockControls, MockSnapshot, Result, SampleRecord, Services, User } from "./types";

const personas: readonly User[] = [
  { id: "admin-demo", name: "Alex Admin", role: "Admin" },
  { id: "sales-river", name: "River Sales", role: "Sales" },
  { id: "sales-sky", name: "Sky Sales", role: "Sales" },
];
const failure = <T>(code: "unauthenticated" | "forbidden" | "request-failure", message: string): Result<T> => ({ ok: false, error: { code, message } });

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
