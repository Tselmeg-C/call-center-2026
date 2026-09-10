import { expect, test, vi } from "vitest";
import { createHttpAdapter } from "./http";

test("HTTP adapter preserves typed auth and conflict errors", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Authentication required." }), { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Conflict." }), { status: 409 })));
  const { services } = createHttpAdapter();
  expect(await services.currentUser()).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
  expect(await services.closeCustomer({ bcn: "000123", submissionId: "s1" })).toMatchObject({ ok: false, error: { code: "conflict" } });
  vi.unstubAllGlobals();
});
