// Domain types mirror the JSON the FastAPI backend actually returns (see apps/api/main.py
// and packages/shared/openapi.yaml), not a UI-shaped model. `@/lib/adapt.ts` maps these onto
// the UI's own `@/lib/types.ts` shapes so routes/components never change.

export type Role = "Admin" | "Sales";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
};

/** One entry in a customer's embedded activity/lifecycle log. `kind` discriminates the shape
 *  (Interaction, Standalone note, Follow-up, Closure, Reopen, Assignment, ...). */
export type HistoryEvent = {
  id: string;
  bcn: string;
  kind: string;
  outcome?: "Attempt" | "Contact" | null;
  text?: string | null;
  note?: string | null;
  actor?: string;
  actorId?: string;
  timestamp?: string;
  createdAt?: string;
  deleted?: boolean;
  deletedBy?: string;
  deletedAt?: string;
  reasonId?: string;
  reason?: string;
  oldOwner?: string | null;
  newOwner?: string | null;
};

export type FollowUpType = "Appointment" | "Reminder";
export type FollowUpStatus = "Open" | "Completed" | "Cancelled";

export type FollowUp = {
  id: string;
  bcn: string;
  type: FollowUpType;
  due: string | null;
  note: string | null;
  status: FollowUpStatus;
  actorId?: string;
  interactionId?: string;
  createdAt: string;
  updatedAt?: string;
};

export type Customer = {
  bcn: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  status: "Open" | "Closed";
  phones: string[];
  source: Record<string, string | number | boolean | null>;
  version: number;
  histories: HistoryEvent[];
  followUps: FollowUp[];
};

export type CustomerPage = { items: Customer[]; page: number; page_size: number; total: number };

export type ClosureReason = { id: string; label: string; active: boolean };

/** Mirrors `apps/api/assignment_rules.py`'s validated condition shape exactly: `field` is one of
 *  `CONDITION_FIELDS`, `operator` is one of that field's allowed operators, and `value`'s shape
 *  depends on `operator` (null for the two null-checks, a two-item tuple for `between`, a string
 *  list for `in`, a bare scalar otherwise). */
export type ConditionOperator = "=" | "!=" | "contains" | "in" | "is-null" | "is-not-null" | "<" | "<=" | ">" | ">=" | "between";
export type ConditionValue = string | number | boolean | string[] | [string, string] | null;
export type RuleCondition = { field: string; operator: ConditionOperator; value: ConditionValue };

export type AssignmentRule = { id: string; name: string; conditions: RuleCondition[]; memberIds: string[]; active: boolean; order: number };

export type ImportError = { row: number; field: string; reason: string };
export type ImportResult = {
  jobId: string;
  submissionId: string;
  filename: string;
  completedAt: string;
  status: "Completed" | "Partial";
  created: number;
  updated: number;
  processed: number;
  errorRows: number;
  errors: ImportError[];
};

export type AssignmentRunResult = { submissionId: string; scope: string; candidates: number; assigned: number; skipped: number };

export type ReportOwnerRow = {
  ownerId: string | null;
  owner: string;
  open: number;
  closed: number;
  neverContacted: number;
  attempts: number;
  contacts: number;
  contactRate: number | null;
  pendingFollowUps: number;
};
export type ReportData = {
  owners: ReportOwnerRow[];
  daily: { date: string; attempts: number; contacts: number }[];
  closureReasons: ClosureReason[];
  followUps: { overdue: number; today: number; undated: number; completed: number };
};

export type AuditEvent = {
  id: string;
  actor: string;
  actorId: string;
  action: string;
  target: string;
  timestamp: string;
  details: Record<string, unknown>;
};
export type AuditPage = { items: AuditEvent[]; page: number; page_size: number; total: number };

export type WorkloadBucket = "overdue" | "today" | "undated" | "never-contacted" | "other";
export type WorkloadCustomer = Customer & { workloadBucket: WorkloadBucket; relevantDue: string | null };
export type Workload = {
  asOf: string;
  today: string;
  counts: Record<WorkloadBucket, number>;
  customers: WorkloadCustomer[];
};

export type ServiceErrorCode = "unauthenticated" | "forbidden" | "request-failure" | "validation" | "conflict" | "rate-limited";
export type ServiceError = { code: ServiceErrorCode; message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: ServiceError };

export type ListCustomersParams = { page?: number; page_size?: number; mine?: boolean; q?: string; status?: "Open" | "Closed"; owner?: string };
export type InteractionInput = { outcome: "Attempt" | "Contact"; note?: string | null; submissionId: string };
export type NoteInput = { text: string; submissionId: string };
export type FollowUpInput = { type: FollowUpType; due?: string | null; note: string; submissionId: string };
export type LifecycleInput = { reasonId?: string; submissionId: string };
export type UserDraft = { name: string; email: string; role: Role; password: string };
export type UserPatch = { name?: string; role?: Role; active?: boolean };
export type AssignmentRuleDraft = { name: string; conditions: RuleCondition[]; memberIds: string[]; active?: boolean };
/** `version` carries the optimistic-concurrency token from the last load (see GET
 *  `/admin/assignment-version`); omitting it (as the active-toggle and reorder controls do) keeps
 *  their existing always-succeeds behavior, while the rule editor sends it to surface a 409 when
 *  another admin changed the configuration first. */
export type AssignmentRulePatch = { name?: string; conditions?: RuleCondition[]; memberIds?: string[]; active?: boolean; order?: number; version?: number };
export type AuditQuery = { actor?: string; action?: string; bcn?: string; page?: number; page_size?: number };

/** Single boundary for every backend call the app makes. One implementation per composition
 *  setting (mock/http); every operation in packages/shared/openapi.yaml has a method here. */
export interface Services {
  login(email: string, password: string): Promise<Result<User>>;
  logout(): Promise<Result<null>>;
  currentUser(): Promise<Result<User>>;
  subscribeSession(listener: (user: User | null) => void): () => void;

  listCustomers(params?: ListCustomersParams): Promise<Result<CustomerPage>>;
  getCustomer(bcn: string): Promise<Result<Customer>>;
  workload(): Promise<Result<Workload>>;

  createInteraction(bcn: string, input: InteractionInput): Promise<Result<HistoryEvent>>;
  createNote(bcn: string, input: NoteInput): Promise<Result<HistoryEvent>>;
  deleteHistory(bcn: string, recordId: string): Promise<Result<HistoryEvent>>;

  createFollowUp(bcn: string, input: FollowUpInput): Promise<Result<FollowUp>>;
  updateFollowUp(bcn: string, followUpId: string, input: FollowUpInput): Promise<Result<FollowUp>>;
  cancelFollowUp(bcn: string, followUpId: string, submissionId: string): Promise<Result<FollowUp>>;
  completeFollowUp(bcn: string, followUpId: string, input: InteractionInput): Promise<Result<FollowUp>>;

  closeCustomer(bcn: string, input: LifecycleInput): Promise<Result<Customer>>;
  reopenCustomer(bcn: string, input: LifecycleInput): Promise<Result<Customer>>;

  listUsers(): Promise<Result<User[]>>;
  createUser(input: UserDraft): Promise<Result<User>>;
  updateUser(id: string, patch: UserPatch): Promise<Result<User>>;

  listClosureReasons(): Promise<Result<ClosureReason[]>>;
  createClosureReason(label: string): Promise<Result<ClosureReason>>;
  updateClosureReason(id: string, patch: { label?: string; active?: boolean }): Promise<Result<ClosureReason>>;

  importWorkbook(file: File, submissionId: string): Promise<Result<ImportResult>>;

  assignCustomer(bcn: string, ownerId: string | null, submissionId: string, expectedVersion?: number): Promise<Result<Customer>>;
  listAssignmentRules(): Promise<Result<AssignmentRule[]>>;
  createAssignmentRule(input: AssignmentRuleDraft): Promise<Result<AssignmentRule>>;
  updateAssignmentRule(id: string, patch: AssignmentRulePatch): Promise<Result<AssignmentRule>>;
  /** The assignment configuration's global optimistic-concurrency counter (GET
   *  `/admin/assignment-version`); bumped by every rule create/update. */
  getAssignmentVersion(): Promise<Result<number>>;
  runAssignments(scope: "unassigned" | "all-open", submissionId: string): Promise<Result<AssignmentRunResult>>;

  reports(start?: string, end?: string): Promise<Result<ReportData>>;
  audit(query?: AuditQuery): Promise<Result<AuditPage>>;
}
