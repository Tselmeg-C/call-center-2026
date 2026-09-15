import { createFileRoute } from "@tanstack/react-router";
import { PhoneCall } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServices } from "@/services/provider";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Northrail Contact Desk" }] }),
  component: Login,
});

function Login() {
  const services = useServices();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await services.login(email.trim(), password);
    setBusy(false);
    // The service layer publishes the new session on success (see subscribeSession); the root
    // route's AuthGate reacts to that and navigates away from here on its own.
    if (!result.ok) setError(result.error.message);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <span className="mb-2 flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <PhoneCall className="size-4" />
          </span>
          <CardTitle>Northrail Outreach</CardTitle>
          <p className="text-sm text-muted-foreground">Sign in to the customer contact desk.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
