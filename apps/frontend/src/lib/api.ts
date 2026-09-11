import type { Customer, User } from "./types";

const base = (import.meta.env["VITE_API_URL"] ?? "/api").replace(/\/$/, "");

async function request<T>(path: string): Promise<T | null> {
  const response = await fetch(`${base}${path}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

type ApiCustomer = {
  bcn: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  status: string;
  phones: string[];
  source: Record<string, unknown>;
};

const statusMap: Record<string, Customer["status"]> = {
  Open: "never_contacted",
  Closed: "closed",
  Attempted: "attempted",
  Contacted: "contacted",
};

function toCustomer(row: ApiCustomer): Customer {
  const source = row.source ?? {};
  const score = Number(source["propensity_score"] ?? 50);
  return {
    bcn: row.bcn,
    mbcn: typeof source["mbcn"] === "string" ? source["mbcn"] as string : null,
    customerName: row.name,
    phones: row.phones.map((number, index) => ({ id: `${row.bcn}-p${index}`, number, primary: index === 0 })),
    previouslyContacted: row.status === "Attempted" || row.status === "Contacted",
    propensityScore: score,
    propensityTier: score >= 80 ? "A" : score >= 60 ? "B" : "C",
    propensityRank: Number(source["propensity_rank"] ?? 0),
    recent: false,
    insideLead: null,
    fieldRep: null,
    scNaming: null,
    insideRep: null,
    branchCode: null,
    rsmName: null,
    originatingBu: null,
    lastPurchaseDate: null,
    revenue: { 2024: 0, 2025: 0, 2026: 0 },
    fem: { 2024: 0, 2025: 0, 2026: 0 },
    paymentTerms: null,
    vendors: [],
    categories: [],
    ownerId: row.ownerId,
    status: statusMap[row.status] ?? "never_contacted",
  };
}

export async function loadBackendState(): Promise<{ user: User; customers: Customer[] } | null> {
  const user = await request<User>("/session/me");
  if (!user) return null;
  const page = await request<{ items: ApiCustomer[] }>("/customers?page=1&page_size=100");
  return page ? { user, customers: page.items.map(toCustomer) } : { user, customers: [] };
}
