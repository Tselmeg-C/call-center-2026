import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bucketOf } from "@/lib/derive";
import { RequireAdmin } from "@/lib/guards";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [
      { title: "Reporting & KPIs — Northrail Admin" },
      {
        name: "description",
        content:
          "Assignment, activity and follow-up KPIs per salesperson: attempts, contacts, contact rate, closures and overdue work.",
      },
      { property: "og:title", content: "Reporting & KPIs — Northrail Admin" },
      { property: "og:description", content: "Contact-centre KPIs across the sales team." },
    ],
  }),
  component: AdminReports,
});

function AdminReports() {
  const { customers, users, activities, followUps } = useStore();

  const perUser = useMemo(
    () =>
      users
        .filter((u) => u.role === "sales")
        .map((u) => {
          const owned = customers.filter((c) => c.ownerId === u.id);
          const attempts = activities.filter((a) => a.userId === u.id && a.outcome === "attempt").length;
          const contacts = activities.filter((a) => a.userId === u.id && a.outcome === "contact").length;
          const open = followUps.filter((f) => f.userId === u.id && !f.completedAt);
          const overdue = open.filter((f) => f.dueAt && new Date(f.dueAt).getTime() < Date.now()).length;
          return {
            name: u.name.split(" ")[0]!,
            fullName: u.name,
            assigned: owned.length,
            active: owned.filter((c) => c.status !== "closed").length,
            closed: owned.filter((c) => c.status === "closed").length,
            never: owned.filter((c) => bucketOf(c, followUps, activities.some((a) => a.bcn === c.bcn)) === "never")
              .length,
            attempts,
            contacts,
            open: open.length,
            overdue,
            completed: followUps.filter((f) => f.userId === u.id && f.completedAt).length,
            rate: attempts + contacts ? Math.round((contacts / (attempts + contacts)) * 100) : 0,
          };
        }),
    [users, customers, activities, followUps],
  );

  const closureData = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) if (c.status === "closed" && c.closureReason)
      map.set(c.closureReason, (map.get(c.closureReason) ?? 0) + 1);
    return [...map.entries()].map(([name, value]) => ({ name, value }));
  }, [customers]);

  const totals = {
    customers: customers.length,
    active: customers.filter((c) => c.status !== "closed").length,
    unassigned: customers.filter((c) => !c.ownerId && c.status !== "closed").length,
    attempts: activities.filter((a) => a.outcome === "attempt").length,
    contacts: activities.filter((a) => a.outcome === "contact").length,
  };
  const contactRate = totals.attempts + totals.contacts
    ? Math.round((totals.contacts / (totals.attempts + totals.contacts)) * 100)
    : 0;

  const pieColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

  return (
    <RequireAdmin>
      <PageHeader title="Reporting & KPIs" description="Assignment, activity and follow-up performance across the team." />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Customers" value={totals.customers} />
        <Kpi label="Active" value={totals.active} />
        <Kpi label="Unassigned" value={totals.unassigned} />
        <Kpi label="Attempts / contacts" value={`${totals.attempts} / ${totals.contacts}`} />
        <Kpi label="Contact rate" value={`${contactRate}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Attempts vs contacts per salesperson</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perUser}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="attempts" name="Attempts" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="contacts" name="Contacts" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Closure reasons</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {closureData.length === 0 ? (
              <p className="pt-10 text-center text-sm text-muted-foreground">No closed customers yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={closureData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95}>
                    {closureData.map((_, i) => (
                      <Cell key={i} fill={pieColors[i % pieColors.length] ?? "var(--chart-1)"} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-surface shadow-panel">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead>Salesperson</TableHead>
              <TableHead className="text-right">Assigned</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">Closed</TableHead>
              <TableHead className="text-right">Never contacted</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead className="text-right">Contacts</TableHead>
              <TableHead className="text-right">Contact rate</TableHead>
              <TableHead className="text-right">Open follow-ups</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="text-right">Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {perUser.map((r) => (
              <TableRow key={r.fullName}>
                <TableCell className="font-medium">{r.fullName}</TableCell>
                <TableCell className="text-right font-mono text-sm">{r.assigned}</TableCell>
                <TableCell className="text-right font-mono text-sm">{r.active}</TableCell>
                <TableCell className="text-right font-mono text-sm">{r.closed}</TableCell>
                <TableCell className="text-right font-mono text-sm">{r.never}</TableCell>
                <TableCell className="text-right font-mono text-sm">{r.attempts}</TableCell>
                <TableCell className="text-right font-mono text-sm">{r.contacts}</TableCell>
                <TableCell className="text-right font-mono text-sm">{r.rate}%</TableCell>
                <TableCell className="text-right font-mono text-sm">{r.open}</TableCell>
                <TableCell className="text-right font-mono text-sm text-destructive">{r.overdue}</TableCell>
                <TableCell className="text-right font-mono text-sm">{r.completed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </RequireAdmin>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-panel">
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
