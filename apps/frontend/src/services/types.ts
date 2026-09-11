import type {
  Activity,
  ActivityOutcome,
  AssignmentEvent,
  AssignmentRule,
  AuditEntry,
  Customer,
  FollowUp,
  FollowUpType,
  ImportJob,
  Note,
  User,
} from "@/lib/types";

/** Everything the UI needs in one read. The mock and any future real backend
 *  return this same shape, so the app never talks to a data source directly. */
export type Snapshot = {
  users: User[];
  customers: Customer[];
  activities: Activity[];
  notes: Note[];
  followUps: FollowUp[];
  assignmentHistory: AssignmentEvent[];
  auditLog: AuditEntry[];
  importJobs: ImportJob[];
  assignmentRules: AssignmentRule[];
};

/** Single boundary for every backend call in the app. */
export type BackendService = {
  getSnapshot(): Promise<Snapshot>;

  logActivity(input: {
    actorId: string;
    bcn: string;
    outcome: ActivityOutcome;
    note: string;
    followUpId?: string;
  }): Promise<Snapshot>;

  createNote(input: { actorId: string; bcn: string; body: string }): Promise<Snapshot>;

  createFollowUp(input: {
    actorId: string;
    bcn: string;
    type: FollowUpType;
    dueAt: string | null;
    note: string;
  }): Promise<Snapshot>;

  closeCustomer(input: { actorId: string; bcn: string; reason: string }): Promise<Snapshot>;
  reopenCustomer(input: { actorId: string; bcn: string }): Promise<Snapshot>;

  reassignCustomer(input: {
    actorId: string;
    bcn: string;
    toUserId: string | null;
    reason: string;
  }): Promise<Snapshot>;

  runAssignment(input: { actorId: string }): Promise<{ snapshot: Snapshot; assigned: number }>;

  setUserActive(input: { actorId: string; userId: string; active: boolean }): Promise<Snapshot>;
  setRuleActive(input: { actorId: string; ruleId: string; active: boolean }): Promise<Snapshot>;

  importCustomers(input: { actorId: string; fileName: string }): Promise<{
    snapshot: Snapshot;
    job: ImportJob;
  }>;
};
