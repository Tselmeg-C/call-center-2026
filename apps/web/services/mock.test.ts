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
  expect(detail).toMatchObject({ ok: true, data: { status: "Closed", closure: { reason: "Won", actor: "Sky Sales", timestamp: "2026-09-26T10:00:00Z" } } });
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

test("deletion only targets activities and standalone notes, keeps follow-up links, and records audit target", async () => {
  const { services } = createMockAdapter({ now: () => "2026-09-10T12:00:00.000Z" }); await services.signIn("sales-sky");
  const before = await services.getCustomer("000124"); expect(before).toMatchObject({ ok: true });
  const histories = (before as { ok: true; data: { histories: { id: string; kind: string; attachedNoteId?: string }[] } }).data.histories;
  expect(histories.find(item => item.id === "i-1")).toMatchObject({ kind: "Interaction", attachedNoteId: "note-fixture-1" });
  expect(histories.find(item => item.id === "i-3")).toMatchObject({ interactionId: "i-1", followUpStatus: "Completed" });
  expect(await services.deleteHistory("000124", "i-3")).toMatchObject({ ok: false, error: { code: "forbidden" } });
  const deleted = await services.deleteHistory("000124", "i-1"); expect(deleted).toMatchObject({ ok: true, data: { customerBcn: "000124", targetId: "i-1", attachedNoteId: "note-fixture-1", deletedBy: "Sky Sales" } });
  const after = await services.getCustomer("000124"); const current = (after as { ok: true; data: { histories: { id: string; deleted?: boolean; interactionId?: string; followUpStatus?: string }[]; contactStatus: string } }).data;
  expect(current.histories.find(item => item.id === "i-1")).toMatchObject({ deleted: true });
  expect(current.histories.find(item => item.id === "i-3")).toMatchObject({ interactionId: "i-1", followUpStatus: "Completed" });
  expect(current.contactStatus).toBe("No recorded interaction");
});

test("a session change during a pending mutation rejects it without changing storage", async () => {
  const { services, controls } = createMockAdapter(); await services.signIn("sales-river"); controls.setScenario("Loading");
  const pending = services.createNote({ bcn: "000123", text: "must not save", submissionId: "session-change" }); controls.setScenario("Normal"); await services.signIn("sales-sky");
  expect(await pending).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
  await services.signIn("sales-river"); const detail = await services.getCustomer("000123");
  expect((detail as { ok: true; data: { histories: { text: string | null }[] } }).data.histories.some(item => item.text === "must not save")).toBe(false);
});

test("follow-ups validate UTC values, link to interactions, and keep retries idempotent", async () => {
  const { services } = createMockAdapter({ now: () => "2026-09-10T12:00:00.000Z" }); await services.signIn("sales-river");
  expect(await services.createFollowUp({ bcn: "000123", type: "Appointment", dueKind: "datetime", due: "2026-09-10T11:00Z" })).toMatchObject({ ok: false, error: { code: "validation" } });
  const interaction = await services.createInteraction({ bcn: "000123", outcome: "Contact", followUp: { type: "Reminder", dueKind: "date", due: "2026-09-12", note: "  call back  " }, submissionId: "with-follow-up" }); expect(interaction).toMatchObject({ ok: true });
  const detail = await services.getCustomer("000123"); const followUps = (detail as { ok: true; data: { followUps: { id: string; note: string | null; interactionId?: string }[] } }).data.followUps; const created = followUps.find(item => item.note === "call back")!; expect(created.interactionId).toMatch(/^interaction-/);
  expect(await services.updateFollowUp({ bcn: "000123", followUpId: created.id, type: "Reminder", dueKind: "date", due: "2026-09-13", note: "edited", submissionId: "edit-1" })).toMatchObject({ ok: true, data: { due: "2026-09-13" } });
  const editAgain = await services.updateFollowUp({ bcn: "000123", followUpId: created.id, type: "Reminder", dueKind: "date", due: "2026-09-13", note: "edited", submissionId: "edit-1" }); expect(editAgain).toMatchObject({ ok: true, data: { due: "2026-09-13" } });
  expect(await services.cancelFollowUp("000123", created.id, "cancel-1")).toMatchObject({ ok: true, data: { status: "Cancelled" } });
  expect(await services.completeFollowUp({ bcn: "000123", followUpId: created.id, outcome: "Contact", submissionId: "complete-after-cancel" })).toMatchObject({ ok: false, error: { code: "conflict" } });
});

test("completion and closure lifecycle preserve history and cancel open work atomically", async () => {
  const { services } = createMockAdapter({ now: () => "2026-09-10T12:00:00.000Z" }); await services.signIn("sales-river");
  const created = await services.createFollowUp({ bcn: "000123", type: "Appointment", dueKind: "datetime", due: "2026-09-11T10:00Z", note: "meeting" }); const id = (created as { ok: true; data: { id: string } }).data.id;
  expect(await services.completeFollowUp({ bcn: "000123", followUpId: id, outcome: "Attempt", note: "no answer", submissionId: "complete-1" })).toMatchObject({ ok: true, data: { status: "Completed" } });
  const second = await services.createFollowUp({ bcn: "000123", type: "Follow-up needed", dueKind: "none", note: "later" }); const secondId = (second as { ok: true; data: { id: string } }).data.id;
  expect(await services.closeCustomer({ bcn: "000123", reasonId: "closure-1", submissionId: "close-1" })).toMatchObject({ ok: true, data: { status: "Closed" } });
  const closed = await services.getCustomer("000123"); const closedData = (closed as { ok: true; data: { followUps: { id: string; status: string }[]; histories: { kind: string }[] } }).data; expect(closedData.followUps.find(item => item.id === secondId)?.status).toBe("Cancelled"); expect(closedData.histories.some(item => item.kind === "Closure")).toBe(true);
  expect(await services.closeCustomer({ bcn: "000123", reasonId: "closure-1", submissionId: "close-2" })).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(await services.reopenCustomer({ bcn: "000123", submissionId: "reopen-1" })).toMatchObject({ ok: true, data: { status: "Open" } });
  const reopened = await services.getCustomer("000123"); expect((reopened as { ok: true; data: { histories: { kind: string }[] } }).data.histories.some(item => item.kind === "Reopen")).toBe(true);
});

test("stale follow-up and lifecycle versions reject without partial mutation", async () => {
  const { services } = createMockAdapter({ now: () => "2026-09-10T12:00:00.000Z" }); await services.signIn("sales-river");
  const created = await services.createFollowUp({ bcn: "000123", type: "Reminder", dueKind: "date", due: "2026-09-11" }); const item = (created as { ok: true; data: { id: string; updatedAt: string } }).data;
  expect(await services.updateFollowUp({ bcn: "000123", followUpId: item.id, type: "Reminder", dueKind: "date", due: "2026-09-12", expectedUpdatedAt: "stale" })).toMatchObject({ ok: false, error: { code: "conflict" } });
  const before = await services.getCustomer("000123"); expect((before as { ok: true; data: { followUps: { id: string; due: string | null }[] } }).data.followUps.find(value => value.id === item.id)?.due).toBe("2026-09-11");
  expect(await services.closeCustomer({ bcn: "000123", reasonId: "closure-1", expectedStatus: "Closed" })).toMatchObject({ ok: false, error: { code: "conflict" } });
});

test("lifecycle duplicate submissions return the original result and tie ordering is stable", async () => {
  const { services } = createMockAdapter({ now: () => "2026-09-10T12:00:00.000Z" }); await services.signIn("sales-river");
  const first = await services.closeCustomer({ bcn: "000123", reasonId: "closure-1", submissionId: "close-once" }); const again = await services.closeCustomer({ bcn: "000123", reasonId: "closure-2", submissionId: "close-once" }); expect(again).toEqual(first);
  const reopened = await services.reopenCustomer({ bcn: "000123", submissionId: "reopen-once" }); const reopenedAgain = await services.reopenCustomer({ bcn: "000123", submissionId: "reopen-once" }); expect(reopenedAgain).toEqual(reopened);
  const one = await services.createFollowUp({ bcn: "000123", type: "Reminder", dueKind: "date", due: "2026-09-15", note: "first" }); const two = await services.createFollowUp({ bcn: "000123", type: "Reminder", dueKind: "date", due: "2026-09-15", note: "second" }); expect(one).toMatchObject({ ok: true }); expect(two).toMatchObject({ ok: true });
  const detail = await services.getCustomer("000123"); const data = (detail as { ok: true; data: { followUps: { id: string; note: string | null }[]; nextFollowUp: string | null } }).data; expect(data.nextFollowUp).toBe("2026-09-15"); expect(data.followUps.filter(item => item.note === "first" || item.note === "second").map(item => item.note)).toEqual(["first", "second"]);
});
