import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RequireAdmin } from "@/lib/guards";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Users & Roles — Northrail Admin" },
      {
        name: "description",
        content: "Manage sales and admin accounts, roles and activation. Deactivating a user releases their open accounts.",
      },
      { property: "og:title", content: "Users & Roles — Northrail Admin" },
      { property: "og:description", content: "Admin user administration for the customer contact desk." },
    ],
  }),
  component: AdminUsers,
});

function AdminUsers() {
  const { users, customers, toggleUserActive } = useStore();

  return (
    <RequireAdmin>
      <PageHeader
        title="Users & Roles"
        description="Deactivating a salesperson releases their open customers to the unassigned pool; history is preserved."
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-panel">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Open customers</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const load = customers.filter((c) => c.ownerId === u.id && c.status !== "closed").length;
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`border-transparent ${
                        u.role === "admin" ? "bg-primary/12 text-primary" : "bg-secondary text-secondary-foreground"
                      }`}
                    >
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{load}</TableCell>
                  <TableCell>
                    <span className={u.active ? "text-sm text-success" : "text-sm text-muted-foreground"}>
                      {u.active ? "Active" : "Deactivated"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={u.active ? "outline" : "secondary"}
                      disabled={u.role === "admin"}
                      onClick={async () => {
                        const succeeded = await toggleUserActive(u.id);
                        if (succeeded) toast.success(u.active ? `${u.name} deactivated` : `${u.name} activated`);
                      }}
                    >
                      {u.active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </RequireAdmin>
  );
}
