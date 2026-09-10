import type { MockControls, Result, Services, User } from "./types";

const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const fail = <T>(message = "Request failed."): Result<T> => ({ ok: false, error: { code: "request-failure", message } });
async function request<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const response = await fetch(`${base}${path}`, { credentials: "include", ...init, headers: { "content-type": "application/json", ...init?.headers } });
    if (!response.ok) return fail(response.status === 401 ? "Authentication required." : response.status === 403 ? "Admin access required." : response.status === 404 ? "Not found." : response.status === 409 ? "Conflict. Refresh and retry." : "Request failed.");
    return { ok: true, data: await response.json() as T };
  } catch { return fail("Network request failed."); }
}

export function createHttpAdapter(): { services: Services; controls: MockControls } {
  let listener = (_user: User | null) => {};
  const services = {
    signIn: (email: string, password?: string) => request<User>("/session/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    signOut: () => request<null>("/session/logout", { method: "POST" }),
    currentUser: () => request<User>("/session/me"),
    listCustomers: async () => { const result = await request<{ items: any[] }>("/customers"); return result.ok ? { ok: true, data: result.data.items } : result; },
    getCustomer: (bcn: string) => request<any>(`/customers/${encodeURIComponent(bcn)}`),
    subscribeSession: (callback: (user: User | null) => void) => { listener = callback; void services.currentUser().then(result => listener(result.ok ? result.data : null)); return () => { listener = () => {}; }; },
  } as unknown as Services;
  const controls = { personas: [], getSnapshot: () => ({ scenario: "Normal" as const, revision: 0, reset: 0, notice: "" }), subscribe: () => () => {}, setScenario: () => {}, reset: () => {} } as MockControls;
  return { services, controls };
}
