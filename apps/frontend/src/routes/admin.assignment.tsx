import { createFileRoute } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dateTime } from "@/lib/derive";
import { RequireAdmin } from "@/lib/guards";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/admin/assignment")({
  head: () => ({
    meta: [
      { title: "Assignment — Northrail Admin" },
      {
        name: "description",
        content:
          "Run the assignment engine, manage priority-ordered rules and reassign customers with a full assignment history.",
      },
      { property: "og:title", content: "Assignment — Northrail Admin" },
      { property: "og:description", content: "Rule-based assignment with balanced workload fallback." },
    ],
  }),
  component: AdminAssignment,
});

function AdminAssignment() {
  const { customers, users, assignmentRules, assignmentHistory, runAssignment, reassign, toggleRule } = useStore();
  const [manualBcn, setManualBcn] = useState("");
  const [manualOwner, setManualOwner] = useState("");

  const unassigned = customers.filter((c) => !c.ownerId && c.status !== "closed");
  const salesUsers = users.filter((u) => u.role === "sales" && u.active);
  const userName = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : "Unassigned");

  return (
    <RequireAdmin>
      <PageHeader
        title="Assignment"
        description="Rules are priority ordered and first-match-wins; unmatched customers fall back to the lightest workload."
        actions={
          <Button
            onClick={async () => {
              const { assigned } = await runAssignment();
              toast.success(
                assigned ? `${assigned} customers assigned` : "Nothing to assign",
                assigned ? { description: "Rules applied, then balanced workload." } : undefined,
              );
            }}
          >
            <Play className="size-4" /> Run assignment ({unassigned.length} unassigned)
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Assignment rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {assignmentRules
                .slice()
                .sort((a, b) => a.priority - b.priority)
                .map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                    <Badge variant="outline" className="border-transparent bg-secondary font-mono text-secondary-foreground">
                      #{r.priority}
                    </Badge>
                    <div className="min-w-48">
                      <p className="text-sm font-medium">{r.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{r.conditions}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Eligible: {r.eligible.map((id) => userName(id)).join(", ")}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{r.active ? "Active" : "Inactive"}</span>
                      <Switch checked={r.active} onCheckedChange={() => toggleRule(r.id)} />
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Manual reassignment</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <Select value={manualBcn} onValueChange={setManualBcn}>
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.bcn} value={c.bcn}>
                      {c.customerName} · {c.bcn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={manualOwner} onValueChange={setManualOwner}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="New owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassign</SelectItem>
                  {salesUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                disabled={!manualBcn || !manualOwner}
                onClick={async () => {
                  const succeeded = await reassign(manualBcn, manualOwner === "none" ? null : manualOwner, "Manual admin reassignment");
                  if (!succeeded) return;
                  toast.success("Ownership updated");
                  setManualBcn("");
                  setManualOwner("");
                }}
              >
                Reassign
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Assignment history</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60">
                    <TableHead>Customer</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignmentHistory.slice(0, 15).map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-mono text-xs">{h.bcn}</TableCell>
                      <TableCell className="text-sm">
                        {userName(h.fromUserId)} → {userName(h.toUserId)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{h.reason}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{dateTime(h.at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Workload</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {salesUsers.map((u) => {
              const open = customers.filter((c) => c.ownerId === u.id && c.status !== "closed").length;
              const closed = customers.filter((c) => c.ownerId === u.id && c.status === "closed").length;
              const max = Math.max(1, ...salesUsers.map((s) => customers.filter((c) => c.ownerId === s.id && c.status !== "closed").length));
              return (
                <div key={u.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{u.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {open} open · {closed} closed
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${(open / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            <p className="pt-2 text-xs text-muted-foreground">
              Closed customers do not count toward workload balancing.
            </p>
          </CardContent>
        </Card>
      </div>
    </RequireAdmin>
  );
}
