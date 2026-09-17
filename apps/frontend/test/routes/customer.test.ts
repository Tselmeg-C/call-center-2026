import { describe, expect, it } from "vitest";
import { pastAppointmentError } from "@/routes/customer.$bcn";

// #86: the Schedule follow-up form blocks past appointment times before sending (no DOM in vitest here).
const now = new Date(2026, 8, 17, 12, 0); // local time, like the datetime-local input

describe("customer: schedule follow-up due check", () => {
  it("blocks an appointment in the past", () => {
    expect(pastAppointmentError("appointment", "2026-09-17T11:00", now)).toMatch(/future/);
    expect(pastAppointmentError("appointment", "2026-09-16T12:00", now)).toMatch(/future/);
  });

  it("allows a future appointment", () => {
    expect(pastAppointmentError("appointment", "2026-09-17T13:00", now)).toBeNull();
  });

  it("does not block past reminders or empty input", () => {
    expect(pastAppointmentError("reminder", "2026-09-16T12:00", now)).toBeNull();
    expect(pastAppointmentError("needed", "", now)).toBeNull();
    expect(pastAppointmentError("appointment", "", now)).toBeNull();
  });
});
