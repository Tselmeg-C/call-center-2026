export type Role = "admin" | "sales";

// The single-owner-per-rule `AssignmentRule` UI type that used to live here is gone: assignment
// rules now carry ordered conditions and a set of eligible members (see
// @/services/types.AssignmentRule), and admin.assignment.tsx consumes that service shape directly
// -- like @/services/types.ClosureReason, it needs no UI-specific adaptation.

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
};

export type CustomerStatus = "never_contacted" | "attempted" | "contacted" | "closed";

export type ActivityOutcome = "attempt" | "contact";

export type Activity = {
  id: string;
  bcn: string;
  outcome: ActivityOutcome;
  at: string;
  userId: string;
  note?: string;
};

export type Note = {
  id: string;
  bcn: string;
  at: string;
  userId: string;
  body: string;
};

export type FollowUpType = "appointment" | "reminder" | "needed";

export type FollowUp = {
  id: string;
  bcn: string;
  type: FollowUpType;
  dueAt: string | null;
  userId: string;
  note?: string;
  completedAt?: string;
};

export type AssignmentEvent = {
  id: string;
  bcn: string;
  fromUserId: string | null;
  toUserId: string | null;
  at: string;
  reason: string;
};

export type AuditEntry = {
  id: string;
  at: string;
  actorId: string;
  action: string;
  target: string;
  detail?: string;
};

export type Customer = {
  bcn: string;
  mbcn: string | null;
  customerName: string;
  phones: { id: string; number: string; primary: boolean }[];
  address?: string | undefined;
  previouslyContacted: boolean;
  propensityScore: number;
  propensityTier: "A" | "B" | "C";
  propensityRank: number;
  recent: boolean;
  insideLead: string | null;
  fieldRep: string | null;
  scNaming: string | null;
  insideRep: string | null;
  branchCode: string | null;
  rsmName: string | null;
  originatingBu: string | null;
  lastPurchaseDate: string | null;
  revenue: { 2024: number; 2025: number; 2026: number };
  fem: { 2024: number; 2025: number; 2026: number };
  paymentTerms: string | null;
  vendors: { name: string; revenue: number }[];
  categories: { name: string; revenue: number }[];
  ownerId: string | null;
  status: CustomerStatus;
  closureReason?: string | undefined;
};

export type ImportJob = {
  id: string;
  fileName: string;
  at: string;
  rowsProcessed: number;
  created: number;
  updated: number;
  errors: string[];
};


export const FOLLOWUP_LABEL: Record<FollowUpType, string> = {
  appointment: "Customer appointment",
  reminder: "Salesperson reminder",
  needed: "Follow-up needed",
};

export const STATUS_LABEL: Record<CustomerStatus, string> = {
  never_contacted: "Never contacted",
  attempted: "Attempted",
  contacted: "Contacted",
  closed: "Closed",
};
