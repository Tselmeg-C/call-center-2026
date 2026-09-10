export type User = { id: string; name: string; role: "Admin" | "Sales" };
export type SampleRecord = { id: string; label: string };
export type Customer = {
  bcn: string; mbcn: string; name: string; ownerId: string | null; ownerName: string | null;
  status: "Open" | "Closed"; previouslyContacted: boolean | null; recent: boolean;
  propensityTier: string | null; propensityRank: number | null; propensityScore: number | null;
  phones: string[]; nextFollowUp: string | null; contactStatus: "Contact" | "Attempt" | "No recorded interaction";
};
export type InteractionOutcome = "Attempt" | "Contact";
export type FollowUpType = "Appointment" | "Reminder" | "Follow-up needed";
export type FollowUpStatus = "Open" | "Completed" | "Cancelled";
export type FollowUp = {
  id: string; bcn: string; type: FollowUpType; due: string | null; dueKind: "date" | "datetime" | "none";
  note: string | null; status: FollowUpStatus; actor: string; actorId: string; createdAt: string;
  updatedAt: string; interactionId?: string; cancelledAt?: string; cancelledBy?: string;
};
export type HistoryRecord = {
  kind: string; id: string; actor: string; actorId?: string; timestamp: string;
  text: string | null; outcome?: InteractionOutcome; deleted?: boolean;
  deletedAt?: string; deletedBy?: string; deletedById?: string; customerBcn?: string; targetId?: string;
  attachedNoteId?: string; interactionId?: string; followUpStatus?: FollowUpStatus;
  followUpId?: string; before?: Partial<FollowUp>; after?: Partial<FollowUp>; reasonId?: string; reason?: string;
};
export type ClosureReason = { id: string; label: string; active: boolean };
export type CustomerDetail = Customer & { source: Record<string, string | number | boolean | null>; histories: HistoryRecord[]; followUps: FollowUp[]; closure?: { reasonId: string; reason: string; actor: string; actorId: string; timestamp: string } };
export type ServiceError = { code: "unauthenticated" | "forbidden" | "request-failure" | "validation" | "conflict"; message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: ServiceError };
export type FollowUpDraft = { type: FollowUpType; due?: string | null; dueKind?: "date" | "datetime" | "none"; note?: string | null };
export type CreateInteractionInput = { bcn: string; outcome: InteractionOutcome; note?: string | null; followUp?: FollowUpDraft | null; submissionId?: string };
export type CreateNoteInput = { bcn: string; text: string; submissionId?: string };
export type FollowUpInput = { bcn: string; type: FollowUpType; due?: string | null; dueKind?: "date" | "datetime" | "none"; note?: string | null; interactionId?: string; submissionId?: string };
export type UpdateFollowUpInput = { bcn: string; followUpId: string; type: FollowUpType; due?: string | null; dueKind?: "date" | "datetime" | "none"; note?: string | null; expectedUpdatedAt?: string; submissionId?: string };
export type CompleteFollowUpInput = { bcn: string; followUpId: string; outcome: InteractionOutcome; note?: string | null; submissionId?: string };
export type LifecycleInput = { bcn: string; reasonId?: string; expectedStatus?: "Open" | "Closed"; submissionId?: string };
export const workloadBuckets = ["overdue", "today", "undated", "never-contacted", "other"] as const;
export type WorkloadBucket = typeof workloadBuckets[number];
export type WorkloadCustomer = Customer & { workloadBucket: WorkloadBucket | null; relevantDue: string | null };
export type WorkloadData = { asOf: string; today: string; customers: WorkloadCustomer[]; counts: Record<WorkloadBucket, number> };

export interface Services {
  signIn(personaId: string): Promise<Result<User>>;
  signOut(): Promise<Result<null>>;
  currentUser(): Promise<Result<User>>;
  sampleRecords(): Promise<Result<SampleRecord[]>>;
  listCustomers(): Promise<Result<Customer[]>>;
  workload(): Promise<Result<WorkloadData>>;
  getCustomer(bcn: string): Promise<Result<CustomerDetail>>;
  createInteraction(input: CreateInteractionInput): Promise<Result<HistoryRecord>>;
  createNote(input: CreateNoteInput): Promise<Result<HistoryRecord>>;
  createFollowUp(input: FollowUpInput): Promise<Result<FollowUp>>;
  updateFollowUp(input: UpdateFollowUpInput): Promise<Result<FollowUp>>;
  cancelFollowUp(bcn: string, followUpId: string, submissionId?: string): Promise<Result<FollowUp>>;
  completeFollowUp(input: CompleteFollowUpInput): Promise<Result<FollowUp>>;
  closeCustomer(input: LifecycleInput): Promise<Result<Customer>>;
  reopenCustomer(input: LifecycleInput): Promise<Result<Customer>>;
  closureReasons(): Promise<Result<ClosureReason[]>>;
  deleteHistory(bcn: string, recordId: string): Promise<Result<HistoryRecord>>;
  subscribeSession(listener: (user: User | null) => void): () => void;
}

export type Scenario = "Normal" | "Loading" | "Empty" | "Error" | "Expired session";
export type MockSnapshot = { scenario: Scenario; revision: number; reset: number; notice: string };
export interface MockControls {
  personas: readonly User[];
  getSnapshot(): MockSnapshot;
  subscribe(listener: () => void): () => void;
  setScenario(scenario: Scenario): void;
  reset(): void;
}
