export type User = { id: string; name: string; role: "Admin" | "Sales" };
export type SampleRecord = { id: string; label: string };
export type Customer = {
  bcn: string; mbcn: string; name: string; ownerId: string | null; ownerName: string | null;
  status: "Open" | "Closed"; previouslyContacted: boolean; recent: boolean;
  propensityTier: string | null; propensityRank: number | null; propensityScore: number | null;
  phones: string[]; nextFollowUp: string | null; contactStatus: "Contact" | "Attempt" | "No recorded interaction";
};
export type CustomerDetail = Customer & { source: Record<string, string | number | boolean | null>; histories: { kind: string; id: string; actor: string; timestamp: string; text: string }[] };
export type ServiceError = { code: "unauthenticated" | "forbidden" | "request-failure"; message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: ServiceError };

export interface Services {
  signIn(personaId: string): Promise<Result<User>>;
  signOut(): Promise<Result<null>>;
  currentUser(): Promise<Result<User>>;
  sampleRecords(): Promise<Result<SampleRecord[]>>;
  listCustomers(): Promise<Result<Customer[]>>;
  getCustomer(bcn: string): Promise<Result<CustomerDetail>>;
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
