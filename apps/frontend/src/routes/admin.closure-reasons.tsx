import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/admin/closure-reasons")({
  head: () => ({
    meta: [
      { title: "Closure Reasons — Northrail Admin" },
      {
        name: "description",
        content: "Manage the reasons available when closing a customer. Deactivating a reason removes it from new closures only.",
      },
      { property: "og:title", content: "Closure Reasons — Northrail Admin" },
      { property: "og:description", content: "Admin closure-reason administration for the customer contact desk." },
    ],
  }),
  component: AdminClosureReasons,
});

function AdminClosureReasons() {
  const { closureReasons, createClosureReason, updateClosureReason } = useStore();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const cancelAdd = () => {
    setAdding(false);
    setLabel("");
    setLabelError(null);
  };

  const submitAdd = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setLabelError("Label is required.");
      return;
    }
    setSubmitting(true);
    const result = await createClosureReason(trimmed);
    setSubmitting(false);
    if (result.ok) {
      toast.success(`"${result.data.label}" added`);
      cancelAdd();
      return;
    }
    if (result.error.code === "conflict") {
      setLabelError("That reason already exists.");
      return;
    }
    setLabelError(result.error.message);
  };

  const toggleActive = async (id: string, label: string, active: boolean) => {
    setTogglingId(id);
    const result = await updateClosureReason(id, { active: !active });
    setTogglingId(null);
    if (result.ok) toast.success(active ? `"${label}" deactivated` : `"${label}" reactivated`);
    else toast.error(result.error.message);
  };

  return (
    <RequireAdmin>
      <PageHeader
        title="Closure Reasons"
        description="Deactivating a reason removes it from the close-customer picker for new closures; customers already closed with it keep showing it."
        actions={
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add reason
            </Button>
          )
        }
      />
      {adding && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-primary/40 bg-surface p-4 shadow-panel">
          <div className="flex-1 space-y-1">
            <Label htmlFor="new-reason-label">Label</Label>
            <Input
              id="new-reason-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-invalid={!!labelError}
              aria-describedby={labelError ? "new-reason-label-error" : undefined}
              autoFocus
            />
            {labelError && (
              <p id="new-reason-label-error" role="alert" className="text-xs text-destructive">
                {labelError}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Button size="sm" onClick={submitAdd} disabled={submitting}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelAdd} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-panel">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead>Label</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {closureReasons.map((reason) => (
              <TableRow key={reason.id}>
                <TableCell className="font-medium">{reason.label}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`border-transparent ${reason.active ? "bg-success/12 text-success" : "bg-secondary text-secondary-foreground"}`}
                  >
                    {reason.active ? "Active" : "Deactivated"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant={reason.active ? "outline" : "secondary"}
                    disabled={togglingId === reason.id}
                    onClick={() => toggleActive(reason.id, reason.label, reason.active)}
                  >
                    {reason.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {closureReasons.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                  No closure reasons yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </RequireAdmin>
  );
}
