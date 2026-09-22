import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpServices } from "@/services/http";

function jsonResponse(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("http services", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends credentials and JSON content-type on requests, and hits the right path/method", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "u1", name: "River", email: "river@example.test", role: "Sales", active: true }));
    vi.stubGlobal("fetch", fetchMock);
    const services = createHttpServices();
    const result = await services.login("river@example.test", "synthetic-only");
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/session/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({ email: "river@example.test", password: "synthetic-only" });
  });

  it("maps HTTP status codes onto typed service error codes", async () => {
    const cases: [number, string][] = [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "request-failure"],
      [409, "conflict"],
      [422, "validation"],
      [429, "rate-limited"],
    ];
    for (const [status, code] of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "x" }, status)));
      const services = createHttpServices();
      const result = await services.getCustomer("000123");
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe(code);
    }
  });

  it("surfaces the backend's detail text as the error message so callers can distinguish same-status conflicts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "Assignment configuration is stale." }, 409)));
    const services = createHttpServices();
    const result = await services.updateAssignmentRule("rule-1", { active: false, version: 1 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("conflict");
    expect(!result.ok && result.error.message).toBe("Assignment configuration is stale.");
  });

  it("falls back to the generic status message when the body has no usable detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 409 })));
    const services = createHttpServices();
    const result = await services.updateAssignmentRule("rule-1", { active: false });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toBe("This changed elsewhere. Refresh and try again.");
  });

  it("reports a request-failure on a network error instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const services = createHttpServices();
    const result = await services.currentUser();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("request-failure");
  });

  it("encodes BCNs and follow-up ids in the path, and sends PATCH for follow-up edits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "f1", bcn: "000123", type: "Reminder", due: null, note: "n", status: "Open", createdAt: "2026-01-01T00:00:00Z" }));
    vi.stubGlobal("fetch", fetchMock);
    const services = createHttpServices();
    await services.updateFollowUp("000123", "f 1/2", { type: "Reminder", due: null, note: "n", submissionId: "s1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/customers/000123/follow-ups/f%201%2F2");
    expect(init.method).toBe("PATCH");
  });

  it("uploads imports as multipart form data without a JSON content-type header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ jobId: "j1", submissionId: "s1", filename: "a.xlsx", completedAt: "2026-01-01T00:00:00Z", status: "Completed", created: 1, updated: 0, processed: 1, errorRows: 0, errors: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const services = createHttpServices();
    const file = new File([new Uint8Array([1, 2, 3])], "a.xlsx");
    const result = await services.importWorkbook(file, "s1");
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/imports?submission_id=s1");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers["content-type"]).toBeUndefined();
  });

  it("fetches the assignment version from its own endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(3));
    vi.stubGlobal("fetch", fetchMock);
    const services = createHttpServices();
    const result = await services.getAssignmentVersion();
    expect(result).toEqual({ ok: true, data: 3 });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/assignment-version");
  });

  it("treats a 204 response as a null-data success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const services = createHttpServices();
    const result = await services.logout();
    expect(result).toEqual({ ok: true, data: null });
  });

  // #121: a session that expires or is revoked while the tab is open (no sign-out click involved)
  // must still flip the shared session state to null, the same way an explicit logout does --
  // otherwise AuthGate never learns the session is gone and the tab is stuck. Every authenticated
  // request routes through this one `request()` helper, so a 401 there is the single place to
  // catch it.
  it("flips the subscribed session to null on any 401, not just an explicit logout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "Sign in to continue." }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const services = createHttpServices();
    const seen: (unknown | null)[] = [];
    services.subscribeSession((user) => seen.push(user));
    await new Promise((resolve) => setTimeout(resolve, 0)); // let subscribeSession's own /session/me settle

    const result = await services.getCustomer("000123");
    expect(result.ok).toBe(false);
    expect(seen[seen.length - 1]).toBeNull();
  });
});
