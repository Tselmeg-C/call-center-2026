import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { Role } from "@/services/types";

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

// #91's NewEmail requires a single "@" with non-empty text on both sides and no whitespace; this
// mirrors just enough of that client-side to catch obvious typos before a round trip, not to
// replace the API's authoritative validation.
const EMAIL_PATTERN = /^\S+@\S+$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

function AddUserForm({ onCancel }: { onCancel: () => void }) {
  const { createUser } = useStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Sales");
  const [password, setPassword] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setGeneralError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    let hasError = false;
    if (!trimmedName) {
      setNameError("Name is required.");
      hasError = true;
    } else {
      setNameError(null);
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailError("Enter a valid email address.");
      hasError = true;
    } else {
      setEmailError(null);
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      setPasswordError(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
      hasError = true;
    } else {
      setPasswordError(null);
    }
    if (hasError) return;

    setSubmitting(true);
    const result = await createUser({ name: trimmedName, email: trimmedEmail, role, password });
    setSubmitting(false);

    if (result.ok) {
      toast.success(`${result.data.name} added`);
      onCancel();
      return;
    }
    if (result.error.code === "conflict") {
      setEmailError("That email is already in use.");
      return;
    }
    // Network/5xx and any other failure: the form (and everything typed into it, other than the
    // password field which is never re-shown) stays open so Save can simply be retried.
    setGeneralError(result.error.message);
  };

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Add user</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {generalError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Could not add user</AlertTitle>
            <AlertDescription>{generalError} You can try again.</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="new-user-name">Name</Label>
            <Input
              id="new-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? "new-user-name-error" : undefined}
            />
            {nameError && (
              <p id="new-user-name-error" role="alert" className="text-xs text-destructive">
                {nameError}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "new-user-email-error" : undefined}
            />
            {emailError && (
              <p id="new-user-email-error" role="alert" className="text-xs text-destructive">
                {emailError}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-user-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="new-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Sales">Sales</SelectItem>
                <SelectItem value="Admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-user-password">Initial password</Label>
            <Input
              id="new-user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`}
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? "new-user-password-error" : undefined}
            />
            {passwordError && (
              <p id="new-user-password-error" role="alert" className="text-xs text-destructive">
                {passwordError}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            Add user
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminUsers() {
  const { users, customers, toggleUserActive, resetUserPassword } = useStore();
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [addingUser, setAddingUser] = useState(false);

  const cancelReset = () => {
    setResettingId(null);
    setPasswordDraft("");
  };

  const submitReset = async (id: string, name: string) => {
    const succeeded = await resetUserPassword(id, passwordDraft);
    if (succeeded) {
      toast.success(`${name}'s password was reset`);
      cancelReset();
    }
  };

  return (
    <RequireAdmin>
      <PageHeader
        title="Users & Roles"
        description="Deactivating a salesperson releases their open customers to the unassigned pool; history is preserved."
        actions={
          !addingUser && (
            <Button size="sm" onClick={() => setAddingUser(true)}>
              <Plus className="size-4" /> Add user
            </Button>
          )
        }
      />
      {addingUser && (
        <div className="mb-6">
          <AddUserForm onCancel={() => setAddingUser(false)} />
        </div>
      )}
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
                    <div className="flex items-center justify-end gap-2">
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
                      {resettingId === u.id ? (
                        <>
                          <Input
                            type="password"
                            autoFocus
                            value={passwordDraft}
                            onChange={(e) => setPasswordDraft(e.target.value)}
                            placeholder="New password (12-128 chars)"
                            className="h-8 w-48"
                          />
                          <Button size="sm" onClick={() => submitReset(u.id, u.name)}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelReset}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setResettingId(u.id)}>
                          Reset password
                        </Button>
                      )}
                    </div>
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
