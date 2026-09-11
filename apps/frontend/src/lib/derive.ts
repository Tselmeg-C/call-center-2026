import type { Customer, FollowUp } from "./types";

export type Bucket = "overdue" | "today" | "undated" | "never" | "other";

export const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: "Overdue follow-ups",
  today: "Follow-ups due today",
  undated: "Follow-ups without date",
  never: "Never contacted",
  other: "Other assigned customers",
};

// UTC-based so server and client agree during hydration.
const startOfToday = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export function openFollowUp(followUps: FollowUp[], bcn: string) {
  return followUps.find((f) => f.bcn === bcn && !f.completedAt);
}

export function bucketOf(customer: Customer, followUps: FollowUp[], hasActivity: boolean): Bucket {
  const fu = openFollowUp(followUps, customer.bcn);
  if (fu) {
    if (fu.dueAt === null) return "undated";
    const due = new Date(fu.dueAt).getTime();
    const today = startOfToday();
    if (due < today) return "overdue";
    if (due < today + 86400000) return "today";
  }
  if (!hasActivity) return "never";
  return "other";
}

export const BUCKET_ORDER: Bucket[] = ["overdue", "today", "undated", "never", "other"];

export function currency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function shortDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function dateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
