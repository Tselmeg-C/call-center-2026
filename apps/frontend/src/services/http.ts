import type {
  AssignmentRule,
  AssignmentRuleDraft,
  AssignmentRulePatch,
  AssignmentRunResult,
  AuditPage,
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
} from "./types";

function failure<T>(code: ServiceErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

function mapError(status: number): [ServiceErrorCode, string] {
  switch (status) {
    case 401:
      return ["unauthenticated", "Sign in to continue."];
    case 403:
      return ["forbidden", "You do not have access to do that."];
    case 404:
      return ["request-failure", "Not found."];
    case 409:
      return ["conflict", "This changed elsewhere. Refresh and try again."];
    case 413:
      return ["validation", "That file is too large."];
    case 422:
      return ["validation", "Check the values and try again."];
    case 429:
      return ["rate-limited", "Too many attempts. Wait and try again."];
    default:
      return ["request-failure", "The request failed. Please retry."];
  }
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const seg = (value: string) => encodeURIComponent(value);
const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type HttpServicesConfig = { baseUrl?: string; origin?: string; fetch?: typeof fetch };

/** `config` lets callers point at a specific backend instance and declare an Origin header —
 *  used by the real-HTTP journey tests (services/__tests__/journeys), which spawn their own
 *  backend process on a random port and are not a browser, so they must set both explicitly.
 *  The real app never passes it: it defaults to same-origin (riding the Vite dev proxy, see
 *  vite.config.ts) with VITE_API_URL/VITE_API_ORIGIN as the production/deployment override. */
export function createHttpServices(config: HttpServicesConfig = {}): Services {
  const base = (config.baseUrl ?? import.meta.env["VITE_API_URL"] ?? "/api").replace(/\/$/, "");
  // Fetch forbids scripts from setting a real "Origin" header in a browser (it is silently
  // dropped and the browser's true origin wins), so this only ever takes effect for non-browser
  // callers such as the Node-based journey tests, letting them satisfy the backend's Origin/
  // Referer guard for unsafe methods without touching backend code.
  const declaredOrigin = config.origin ?? import.meta.env["VITE_API_ORIGIN"];
  // A browser needs no cookie jar (it has its own); the real-HTTP journey tests run in Node,
  // which does not persist cookies across fetch() calls on its own, so they inject one here
  // (see __tests__/journeys/backend.ts) instead of this module carrying jar logic it would
  // never use in production.
  const doFetch = config.fetch ?? fetch;
  let sessionListener: (user: User | null) => void = () => {};

  async function request<T>(path: string, init?: RequestInit): Promise<Result<T>> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        credentials: "include",
        ...init,
        headers: {
          ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
          ...(declaredOrigin ? { origin: declaredOrigin, referer: `${declaredOrigin}/` } : {}),
          ...init?.headers,
        },
      });
    } catch {
      return failure("request-failure", "Network request failed.");
    }
    if (!response.ok) {
      const [code, fallbackMessage] = mapError(response.status);
      // FastAPI's HTTPException(status, "some message") always serializes as {"detail": "some
      // message"}; surfacing it (when present) lets callers distinguish e.g. a 409 "name already
      // in use" from a 409 stale-version conflict, which share a status code but need different
      // inline UI treatment (see admin.assignment.tsx).
      let detail: string | undefined;
      try {
        const body: unknown = await response.json();
        if (body && typeof body === "object" && typeof (body as { detail?: unknown }).detail === "string") {
          detail = (body as { detail: string }).detail;
        }
      } catch {
        // No/invalid JSON body -- fall back to the generic status-code message below.
      }
      return failure(code, detail ?? fallbackMessage);
    }
    if (response.status === 204) return { ok: true, data: null as T };
    return { ok: true, data: (await response.json()) as T };
  }

  return {
    login: async (email, password) => {
      const result = await request<User>("/session/login", json("POST", { email, password }));
      if (result.ok) sessionListener(result.data);
      return result;
    },
    logout: async () => {
      const result = await request<null>("/session/logout", { method: "POST" });
      sessionListener(null);
      return result;
    },
    currentUser: () => request<User>("/session/me"),
    subscribeSession: (listener) => {
      sessionListener = listener;
      void request<User>("/session/me").then((result) => sessionListener(result.ok ? result.data : null));
      return () => {
        sessionListener = () => {};
      };
    },

    listCustomers: (params: ListCustomersParams = {}) =>
      request<CustomerPage>(`/customers${qs({ page: params.page, page_size: params.page_size, mine: params.mine, q: params.q, status: params.status, owner: params.owner })}`),
    getCustomer: (bcn) => request<Customer>(`/customers/${seg(bcn)}`),
    workload: () => request<Workload>("/workload"),

    createInteraction: (bcn, input: InteractionInput) => request<HistoryEvent>(`/customers/${seg(bcn)}/interactions`, json("POST", input)),
    createNote: (bcn, input: NoteInput) => request<HistoryEvent>(`/customers/${seg(bcn)}/notes`, json("POST", input)),
    deleteHistory: (bcn, recordId) => request<HistoryEvent>(`/customers/${seg(bcn)}/history/${seg(recordId)}`, { method: "DELETE" }),

    createFollowUp: (bcn, input: FollowUpInput) => request<FollowUp>(`/customers/${seg(bcn)}/follow-ups`, json("POST", input)),
    updateFollowUp: (bcn, followUpId, input: FollowUpInput) => request<FollowUp>(`/customers/${seg(bcn)}/follow-ups/${seg(followUpId)}`, json("PATCH", input)),
    cancelFollowUp: (bcn, followUpId, submissionId) => request<FollowUp>(`/customers/${seg(bcn)}/follow-ups/${seg(followUpId)}/cancel`, json("POST", { submissionId })),
    completeFollowUp: (bcn, followUpId, input: InteractionInput) => request<FollowUp>(`/customers/${seg(bcn)}/follow-ups/${seg(followUpId)}/complete`, json("POST", input)),

    closeCustomer: (bcn, input: LifecycleInput) => request<Customer>(`/customers/${seg(bcn)}/close`, json("POST", input)),
    reopenCustomer: (bcn, input: LifecycleInput) => request<Customer>(`/customers/${seg(bcn)}/reopen`, json("POST", input)),

    listUsers: () => request<User[]>("/admin/users"),
    createUser: (input: UserDraft) => request<User>("/admin/users", json("POST", input)),
    updateUser: (id, patch: UserPatch) => request<User>(`/admin/users/${seg(id)}`, json("PATCH", patch)),
    resetUserPassword: (id, password) => request<User>(`/admin/users/${seg(id)}/reset-password`, json("POST", { password })),

    listClosureReasons: () => request<ClosureReason[]>("/admin/closure-reasons"),
    createClosureReason: (label) => request<ClosureReason>("/admin/closure-reasons", json("POST", { label })),
    updateClosureReason: (id, patch) => request<ClosureReason>(`/admin/closure-reasons/${seg(id)}`, json("PATCH", patch)),

    importWorkbook: async (file, submissionId) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return request<ImportResult>(`/admin/imports${qs({ submission_id: submissionId })}`, { method: "POST", body: form });
    },

    assignCustomer: (bcn, ownerId, submissionId, expectedVersion) =>
      request<Customer>(`/admin/assignments/manual/${seg(bcn)}`, json("POST", { ownerId, submissionId, expectedVersion })),
    listAssignmentRules: () => request<AssignmentRule[]>("/admin/assignment-rules"),
    createAssignmentRule: (input: AssignmentRuleDraft) => request<AssignmentRule>("/admin/assignment-rules", json("POST", input)),
    updateAssignmentRule: (id, patch: AssignmentRulePatch) => request<AssignmentRule>(`/admin/assignment-rules/${seg(id)}`, json("PATCH", patch)),
    getAssignmentVersion: () => request<number>("/admin/assignment-version"),
    runAssignments: (scope, submissionId) => request<AssignmentRunResult>("/admin/assignment-runs", json("POST", { scope, submissionId })),

    reports: (start, end) => request<ReportData>(`/admin/reports${qs({ start, end })}`),
    audit: (query = {}) => request<AuditPage>(`/admin/audit${qs({ actor: query.actor, action: query.action, bcn: query.bcn, page: query.page, page_size: query.page_size })}`),
  };
}
