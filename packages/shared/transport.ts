/** Generated transport shapes. Regenerate/check with `node packages/shared/validate-openapi.mjs`. */
export type ApiRole = "Admin" | "Sales";
export type ApiUser = { id: string; name: string; email?: string; role: ApiRole; active?: boolean };
export type ApiError = { code: string; message: string; requestId: string; fieldErrors?: Record<string, string[]> };
export type ApiPage<T> = { items: T[]; page: number; page_size: number; total: number };
export type ApiMutation = { submissionId: string; expectedVersion?: string | number };
export type ApiDate = string;
export type ApiInstant = string;
export type ApiCustomer = { bcn: string; name: string; ownerId: string | null; ownerName: string | null; status: "Open" | "Closed" };
export type ApiFollowUp = { id: string; bcn: string; type: "Appointment" | "Reminder" | "Follow-up needed"; due: string | null; dueKind: "date" | "datetime" | "none"; status: "Open" | "Completed" | "Cancelled" };
export type ApiAuditEvent = { id: string; actor: string; actorId: string; action: string; target: string; timestamp: ApiInstant; details: Record<string, unknown> };
