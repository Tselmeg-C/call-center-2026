import type { Customer, CustomerDetail, User, WorkloadBucket, WorkloadCustomer, WorkloadData } from "./types";

const bucketOrder: WorkloadBucket[] = ["overdue", "today", "undated", "never-contacted", "other"];
const dateValue = (due: string | null, kind: "date" | "datetime" | "none") => kind === "none" || !due ? null : due.slice(0, 10);

export function calculateWorkload(customers: CustomerDetail[], user: User, now: string): WorkloadData {
  const today = now.slice(0, 10);
  const rows: WorkloadCustomer[] = customers.map(customer => {
    if (customer.status !== "Open" || customer.ownerId !== user.id) return { ...customer, workloadBucket: null, relevantDue: null };
    const open = customer.followUps.filter(item => item.status === "Open");
    const dated = open.flatMap(item => {
      const day = dateValue(item.due, item.dueKind);
      return day ? [{ day, due: item.due }] : [];
    }).sort((a, b) => a.day.localeCompare(b.day) || (a.due ?? "").localeCompare(b.due ?? ""));
    const hasContact = customer.histories.some(item => item.kind === "Interaction" && item.outcome === "Contact" && !item.deleted);
    const undated = open.some(item => item.dueKind === "none");
    const bucket: WorkloadBucket = dated.some(item => item.day < today) ? "overdue" : dated.some(item => item.day === today) ? "today" : undated ? "undated" : !hasContact && customer.previouslyContacted !== true ? "never-contacted" : "other";
    return { ...customer, workloadBucket: bucket, relevantDue: (bucket === "overdue" || bucket === "today") ? dated.find(item => bucket === "overdue" ? item.day < today : item.day === today)?.due ?? null : null };
  });
  const compare = (a: Customer, b: Customer) => {
    const rank = (a.propensityRank == null ? Number.POSITIVE_INFINITY : a.propensityRank) - (b.propensityRank == null ? Number.POSITIVE_INFINITY : b.propensityRank);
    if (rank) return rank;
    const score = (b.propensityScore == null ? Number.NEGATIVE_INFINITY : b.propensityScore) - (a.propensityScore == null ? Number.NEGATIVE_INFINITY : a.propensityScore);
    return score || a.bcn.localeCompare(b.bcn);
  };
  rows.sort((a, b) => (a.workloadBucket ? bucketOrder.indexOf(a.workloadBucket) : bucketOrder.length) - (b.workloadBucket ? bucketOrder.indexOf(b.workloadBucket) : bucketOrder.length) || ((a.relevantDue ?? "").localeCompare(b.relevantDue ?? "")) || compare(a, b));
  const counts = Object.fromEntries(bucketOrder.map(bucket => [bucket, rows.filter(row => row.workloadBucket === bucket).length])) as Record<WorkloadBucket, number>;
  return { asOf: now, today, customers: rows, counts };
}
