// Maps the service layer's backend-shaped types (@/services/types) onto this app's own UI
// types (@/lib/types) so routes and components never need to change shape. Kept as pure
// functions so they're easy to unit test independently of React/network state.
import type {
  Customer as ServiceCustomer,
  FollowUp as ServiceFollowUp,
  HistoryEvent,
  User as ServiceUser,
} from "@/services/types";
import type {
  Activity,
  AssignmentEvent,
  Customer,
  CustomerStatus,
  FollowUp,
  Note,
  User,
} from "@/lib/types";

export function toUser(user: ServiceUser): User {
  return { id: user.id, name: user.name, email: user.email, role: user.role === "Admin" ? "admin" : "sales", active: user.active };
}

const numberOf = (value: unknown): number => (typeof value === "number" ? value : 0);
const stringOf = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

function customerStatus(customer: ServiceCustomer): CustomerStatus {
  if (customer.status === "Closed") return "closed";
  const interactions = customer.histories.filter((event) => event.kind === "Interaction" && !event.deleted);
  const latest = interactions[interactions.length - 1];
  if (!latest) return "never_contacted";
  return latest.outcome === "Contact" ? "contacted" : "attempted";
}

function closureReasonLabel(customer: ServiceCustomer): string | undefined {
  const closures = customer.histories.filter((event) => event.kind === "Closure");
  return closures[closures.length - 1]?.reason ?? undefined;
}

export function toCustomer(customer: ServiceCustomer): Customer {
  const source = customer.source;
  const vendors = [1, 2, 3]
    .map((index) => ({ name: stringOf(source[`vendor_${index}`]), revenue: numberOf(source[`vendor_${index}_revenue`]) }))
    .filter((item): item is { name: string; revenue: number } => item.name !== null);
  const categories = [1, 2, 3]
    .map((index) => ({ name: stringOf(source[`category_${index}`]), revenue: numberOf(source[`category_${index}_revenue`]) }))
    .filter((item): item is { name: string; revenue: number } => item.name !== null);
  const tier = stringOf(source["propensity_tier"]);
  return {
    bcn: customer.bcn,
    mbcn: stringOf(source["mbcn"]),
    customerName: customer.name,
    phones: customer.phones.map((number, index) => ({ id: `${customer.bcn}-p${index}`, number, primary: index === 0 })),
    previouslyContacted: source["previously_contacted"] === true,
    propensityScore: numberOf(source["propensity_score"]),
    propensityTier: tier === "A" || tier === "B" || tier === "C" ? tier : "C",
    propensityRank: numberOf(source["propensity_rank"]),
    recent: source["recent"] === true,
    insideLead: stringOf(source["inside_lead"]),
    fieldRep: stringOf(source["field_rep"]),
    scNaming: stringOf(source["sc_naming"]),
    insideRep: stringOf(source["inside_rep"]),
    branchCode: stringOf(source["branch_code"]),
    rsmName: stringOf(source["rsm_name"]),
    originatingBu: stringOf(source["originating_bu"]),
    lastPurchaseDate: stringOf(source["last_purchase_date"]),
    revenue: { 2024: numberOf(source["revenue_amount_2024"]), 2025: numberOf(source["revenue_amount_2025"]), 2026: numberOf(source["revenue_amount_2026"]) },
    fem: { 2024: numberOf(source["fem_amount_2024"]), 2025: numberOf(source["fem_amount_2025"]), 2026: numberOf(source["fem_amount_2026"]) },
    paymentTerms: stringOf(source["payment_terms"]),
    vendors,
    categories,
    ownerId: customer.ownerId,
    status: customerStatus(customer),
    closureReason: closureReasonLabel(customer),
  };
}

/** Real backend history rows don't always carry an id (e.g. Assignment events in memory mode),
 *  so callers pass an index to synthesize a stable one. */
const historyId = (event: HistoryEvent, index: number) => event.id || `${event.kind}-${event.bcn}-${index}`;

export function toActivities(customer: ServiceCustomer): Activity[] {
  return customer.histories
    .map((event, index) => ({ event, id: historyId(event, index) }))
    .filter(({ event }) => event.kind === "Interaction" && !event.deleted)
    .map(({ event, id }) => ({
      id,
      bcn: customer.bcn,
      outcome: event.outcome === "Contact" ? "contact" : "attempt",
      at: event.timestamp ?? event.createdAt ?? "",
      userId: event.actorId ?? "",
      ...(event.text ? { note: event.text } : {}),
    }));
}

export function toNotes(customer: ServiceCustomer): Note[] {
  return customer.histories
    .map((event, index) => ({ event, id: historyId(event, index) }))
    .filter(({ event }) => event.kind === "Standalone note" && !event.deleted)
    .map(({ event, id }) => ({ id, bcn: customer.bcn, at: event.timestamp ?? event.createdAt ?? "", userId: event.actorId ?? "", body: event.text ?? "" }));
}

export function toAssignmentEvents(customer: ServiceCustomer): AssignmentEvent[] {
  return customer.histories
    .map((event, index) => ({ event, id: historyId(event, index) }))
    .filter(({ event }) => event.kind === "Assignment")
    .map(({ event, id }) => ({ id, bcn: customer.bcn, fromUserId: event.oldOwner ?? null, toUserId: event.newOwner ?? null, at: event.timestamp ?? event.createdAt ?? "", reason: event.reason ?? "" }));
}

/** UI "needed" (no date allowed) has no backend equivalent (the API only knows Appointment and
 *  Reminder); it round-trips as a Reminder with no due date. */
export function toFollowUpType(type: ServiceFollowUp["type"], due: string | null): FollowUp["type"] {
  if (type === "Appointment") return "appointment";
  return due === null ? "needed" : "reminder";
}
export function fromFollowUpType(type: FollowUp["type"]): ServiceFollowUp["type"] {
  return type === "appointment" ? "Appointment" : "Reminder";
}

export function toFollowUp(item: ServiceFollowUp): FollowUp {
  return {
    id: item.id,
    bcn: item.bcn,
    type: toFollowUpType(item.type, item.due),
    dueAt: item.due,
    userId: item.actorId ?? "",
    ...(item.note ? { note: item.note } : {}),
    ...(item.status === "Completed" ? { completedAt: item.updatedAt ?? item.createdAt } : {}),
  };
}

export const newSubmissionId = () => crypto.randomUUID();
