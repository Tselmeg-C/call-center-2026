import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { BucketBadge, StatusBadge, TierBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bucketOf, currency, openFollowUp, shortDate } from "@/lib/derive";
import { useStore } from "@/lib/store";
import type { Customer } from "@/lib/types";

export function CustomerTable({
  rows,
  showOwner = true,
  emptyLabel = "No customers match this view.",
}: {
  rows: Customer[];
  showOwner?: boolean;
  emptyLabel?: string;
}) {
  const { users, activities, followUps, canWork } = useStore();

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-panel">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60">
            <TableHead className="min-w-56">Customer</TableHead>
            <TableHead>Next action</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Propensity</TableHead>
            <TableHead className="text-right">Revenue 2025</TableHead>
            <TableHead>Last purchase</TableHead>
            {showOwner && <TableHead>Owner</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={showOwner ? 7 : 6} className="py-10 text-center text-sm text-muted-foreground">
                {emptyLabel}
              </TableCell>
            </TableRow>
          )}
          {rows.map((c) => {
            const hasActivity = activities.some((a) => a.bcn === c.bcn);
            const fu = openFollowUp(followUps, c.bcn);
            const owner = users.find((u) => u.id === c.ownerId);
            return (
              <TableRow key={c.bcn} className="align-top">
                <TableCell>
                  <Link
                    to="/customer/$bcn"
                    params={{ bcn: c.bcn }}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {c.customerName}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    {c.bcn}
                    {!canWork(c) && (
                      <span className="inline-flex items-center gap-1" title="Read-only — owned by another salesperson">
                        <Lock className="size-3" /> read-only
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <BucketBadge bucket={bucketOf(c, followUps, hasActivity)} />
                  <div className="mt-1 text-xs text-muted-foreground">
                    {fu ? (fu.dueAt ? shortDate(fu.dueAt) : "No date set") : "—"}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={c.status} />
                  {c.closureReason && (
                    <div className="mt-1 text-xs text-muted-foreground">{c.closureReason}</div>
                  )}
                </TableCell>
                <TableCell>
                  <TierBadge tier={c.propensityTier} />
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {c.propensityScore} · rank {c.propensityRank}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{currency(c.revenue[2025])}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{shortDate(c.lastPurchaseDate)}</TableCell>
                {showOwner && (
                  <TableCell className="text-sm">
                    {owner ? owner.name : <span className="text-muted-foreground">Unassigned</span>}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
