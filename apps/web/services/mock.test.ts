import { expect, test } from "vitest";
import { createMockAdapter } from "./mock";

test("personas have deterministic records and typed auth failures; adapters are independent", async () => {
  const { services, controls } = createMockAdapter();
  expect(await services.currentUser()).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
  expect(await services.sampleRecords()).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
  expect(await services.signIn("unknown")).toMatchObject({ ok: false, error: { code: "forbidden" } });
  for (const persona of controls.personas) {
    expect(await services.signIn(persona.id)).toMatchObject({ ok: true, data: persona });
    const first = await services.sampleRecords();
    expect(first).toMatchObject({ ok: true, data: [{ id: `${persona.id}-sample` }] });
    controls.reset(); await services.signIn(persona.id);
    expect(await services.sampleRecords()).toEqual(first);
  }
  expect(await createMockAdapter().services.currentUser()).toMatchObject({ ok: false });
});

test("logout, expiry and reset invalidate pending protected results", async () => {
  for (const action of ["logout", "expiry", "reset"] as const) {
    const { services, controls } = createMockAdapter();
    await services.signIn("sales-river"); controls.setScenario("Loading");
    const pending = services.sampleRecords();
    if (action === "logout") await services.signOut();
    if (action === "expiry") controls.setScenario("Expired session");
    if (action === "reset") controls.reset();
    expect(await pending).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
    controls.setScenario("Normal");
    expect(await services.currentUser()).toMatchObject({ ok: false });
    await services.signIn("sales-sky");
    expect(await services.sampleRecords()).toMatchObject({ ok: true, data: [{ id: "sales-sky-sample" }] });
  }
});

test("Loading remains pending, reset cancels sign-in and Error fails once", async () => {
  const { services, controls } = createMockAdapter(); controls.setScenario("Loading");
  let resolved = false;
  const pending = services.signIn("sales-river").then(result => { resolved = true; return result; });
  await Promise.resolve(); expect(resolved).toBe(false);
  controls.reset(); expect(await pending).toMatchObject({ ok: false });
  controls.setScenario("Error");
  expect(await services.signIn("sales-river")).toMatchObject({ ok: false, error: { code: "request-failure" } });
  expect(await services.currentUser()).toMatchObject({ ok: false });
  expect(await services.signIn("sales-river")).toMatchObject({ ok: true });
});

test("a persona change invalidates an earlier session's in-flight read", async () => {
  const { services } = createMockAdapter();
  await services.signIn("sales-river");
  const change = services.signIn("sales-sky");
  const previousRead = services.sampleRecords();
  await change;
  expect(await previousRead).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
  expect(await services.sampleRecords()).toMatchObject({ ok: true, data: [{ id: "sales-sky-sample" }] });
});

test("customer reads preserve leading-zero BCN and full history", async () => {
  const { services } = createMockAdapter(); await services.signIn("sales-river");
  const list = await services.listCustomers(); expect(list).toMatchObject({ ok: true }); expect((list as { ok: true; data: { bcn: string }[] }).data.map(item => item.bcn)).toContain("000123");
  const detail = await services.getCustomer("000124"); expect(detail).toMatchObject({ ok: true, data: { bcn: "000124" } });
  expect((detail as { ok: true; data: { histories: unknown[] }}).data.histories).toHaveLength(30);
});

test("interaction and note creation trims, validates, deduplicates, and uses the injected clock", async () => {
  const { services } = createMockAdapter({ now: () => "2026-09-10T12:00:00.000Z" }); await services.signIn("sales-river");
  const interaction = await services.createInteraction({ bcn: "000123", outcome: "Contact", note: "  <b>answered</b>  ", submissionId: "intent-1" });
  expect(interaction).toMatchObject({ ok: true, data: { kind: "Interaction", outcome: "Contact", text: "<b>answered</b>", timestamp: "2026-09-10T12:00:00.000Z" } });
  const duplicate = await services.createInteraction({ bcn: "000123", outcome: "Contact", note: "<b>answered</b>", submissionId: "intent-1" }); expect(duplicate).toEqual(interaction);
  const separate = await services.createInteraction({ bcn: "000123", outcome: "Contact", note: "<b>answered</b>", submissionId: "intent-2" }); expect(separate).toMatchObject({ ok: true }); expect(separate).not.toEqual(interaction);
  expect(await services.createNote({ bcn: "000123", text: "  " })).toMatchObject({ ok: false, error: { code: "validation", message: "Note is required." } });
  expect(await services.createNote({ bcn: "000123", text: "x".repeat(4001) })).toMatchObject({ ok: false, error: { code: "validation" } });
  const detail = await services.getCustomer("000123"); expect(detail).toMatchObject({ ok: true, data: { contactStatus: "Contact" } });
  expect((detail as { ok: true; data: { histories: { text: string | null }[] } }).data.histories.some(item => item.text === "<b>answered</b>")).toBe(true);
});

test("ownership, closed status, deletion tombstones, idempotent delete, and failure rollback are enforced", async () => {
  const { services, controls } = createMockAdapter({ now: () => "2026-09-10T12:00:00.000Z" }); await services.signIn("sales-river");
  const created = await services.createNote({ bcn: "000123", text: "keep this", submissionId: "note-1" }); expect(created).toMatchObject({ ok: true });
  const recordId = (created as { ok: true; data: { id: string } }).data.id;
  controls.setScenario("Error"); expect(await services.createNote({ bcn: "000123", text: "retry me", submissionId: "note-2" })).toMatchObject({ ok: false, error: { code: "request-failure" } });
  expect(await services.createNote({ bcn: "000123", text: "retry me", submissionId: "note-2" })).toMatchObject({ ok: true });
  expect(await services.deleteHistory("000123", recordId)).toMatchObject({ ok: true, data: { deleted: true, text: null, deletedBy: "River Sales" } });
  const deleted = await services.deleteHistory("000123", recordId); expect(deleted).toMatchObject({ ok: true, data: { deleted: true } });
  await services.signIn("sales-sky"); expect(await services.createNote({ bcn: "000123", text: "blocked" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect(await services.deleteHistory("000123", recordId)).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect(await services.createInteraction({ bcn: "000124", outcome: "Attempt" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
});
