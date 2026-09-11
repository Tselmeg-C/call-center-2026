import { Badge } from "@/components/ui/badge";
import type { Bucket } from "@/lib/derive";
import { BUCKET_LABEL } from "@/lib/derive";
import { STATUS_LABEL, type CustomerStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: CustomerStatus }) {
  const cls: Record<CustomerStatus, string> = {
    never_contacted: "bg-muted text-muted-foreground",
    attempted: "bg-warning/15 text-warning-foreground",
    contacted: "bg-success/15 text-success",
    closed: "bg-secondary text-secondary-foreground",
  };
  return (
    <Badge variant="outline" className={`border-transparent font-medium ${cls[status]}`}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function BucketBadge({ bucket }: { bucket: Bucket }) {
  const cls: Record<Bucket, string> = {
    overdue: "bg-destructive/12 text-destructive",
    today: "bg-info/15 text-info",
    undated: "bg-warning/15 text-warning-foreground",
    never: "bg-muted text-muted-foreground",
    other: "bg-secondary text-secondary-foreground",
  };
  const short: Record<Bucket, string> = {
    overdue: "Overdue",
    today: "Due today",
    undated: "Undated",
    never: "Never contacted",
    other: "Nurture",
  };
  return (
    <Badge variant="outline" className={`border-transparent font-medium ${cls[bucket]}`} title={BUCKET_LABEL[bucket]}>
      {short[bucket]}
    </Badge>
  );
}

export function TierBadge({ tier }: { tier: "A" | "B" | "C" }) {
  const cls = {
    A: "bg-primary/12 text-primary",
    B: "bg-info/12 text-info",
    C: "bg-muted text-muted-foreground",
  }[tier];
  return (
    <Badge variant="outline" className={`border-transparent font-mono text-[11px] ${cls}`}>
      Tier {tier}
    </Badge>
  );
}
