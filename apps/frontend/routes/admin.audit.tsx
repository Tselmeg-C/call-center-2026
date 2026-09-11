import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dateTime } from "@/lib/derive";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/admin/audit")({
  head: () => ({
    meta: [
      { title: "Audit Log — Northrail Admin" },
      {
        name: "description",
        content: "Audit trail of ownership changes, closures, imports, rule edits and user activation events.",
      },
      { property: "og:title", content: "Audit Log — Northrail Admin" },
      { property: "og:description", content: "Traceability for administrative and ownership actions." },
    ],
  }),
  component: AdminAudit,
});

function AdminAudit() {
  const { auditLog, users } = useStore();
  return (
    <>
      <PageHeader title="Audit Log" description="Every ownership, closure, import and administrative change." />
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-panel">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auditLog.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateTime(entry.at)}</TableCell>
                <TableCell className="text-sm">
                  {users.find((u) => u.id === entry.actorId)?.name ?? entry.actorId}
                </TableCell>
                <TableCell className="text-sm font-medium">{entry.action}</TableCell>
                <TableCell className="font-mono text-xs">{entry.target}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{entry.detail ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
