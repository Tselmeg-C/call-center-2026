import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Lock,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  StickyNote,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, TierBadge } from "@/components/StatusBadge";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { currency, dateTime, openFollowUp, shortDate } from "@/lib/derive";
import { useStore } from "@/lib/store";
import { FOLLOWUP_LABEL, type ActivityOutcome, type FollowUpType } from "@/lib/types";

export const Route = createFileRoute("/customer/$bcn")({
  head: ({ params }) => ({
    meta: [
      { title: `Customer ${params.bcn} — Northrail Contact Desk` },
      {
        name: "description",
        content: `Master data, interaction history, notes and follow-ups for customer ${params.bcn}.`,
      },
      { property: "og:title", content: `Customer ${params.bcn} — Northrail Contact Desk` },
      {
        property: "og:description",
        content: "Record calls, add notes, schedule follow-ups and manage closure for this account.",
      },
    ],
  }),
  component: CustomerDetail,
});

/** #86: the API rejects an appointment whose due time is already past, so explain it before sending.
 * `localValue` is the datetime-local input value (browser local time). */
export function pastAppointmentError(type: FollowUpType, localValue: string, now = new Date()) {
  if (type !== "appointment" || !localValue) return null;
  return new Date(localValue).getTime() < now.getTime()
    ? "Appointments must be scheduled in the future."
    : null;
}

function CustomerDetail() {
  const { bcn } = Route.useParams();
  const {
    customers,
    users,
    activities,
    notes,
    followUps,
    assignmentHistory,
    closureReasons,
    canWork,
    addActivity,
    addNote,
    addFollowUp,
    closeCustomer,
    reopenCustomer,
  } = useStore();

  const customer = customers.find((c) => c.bcn === bcn);
  const activeReasons = closureReasons.filter((r) => r.active);
  const [outcome, setOutcome] = useState<ActivityOutcome>("contact");
  const [activityNote, setActivityNote] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [fuType, setFuType] = useState<FollowUpType>("appointment");
  const [fuDate, setFuDate] = useState("");
  const [fuNote, setFuNote] = useState("");
  const [closeReasonId, setCloseReasonId] = useState("");

  if (!customer) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-lg font-semibold">Customer not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">No customer exists with BCN {bcn}.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/all-customers">Back to all customers</Link>
        </Button>
      </div>
    );
  }

  const editable = canWork(customer);
  const owner = users.find((u) => u.id === customer.ownerId);
  const custActivities = activities.filter((a) => a.bcn === bcn);
  const custNotes = notes.filter((n) => n.bcn === bcn);
  const custFollowUps = followUps.filter((f) => f.bcn === bcn);
  const custAssignments = assignmentHistory.filter((h) => h.bcn === bcn);
  const open = openFollowUp(followUps, bcn);
  const dueError = pastAppointmentError(fuType, fuDate);
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? "Unknown";

  const logActivity = async (completeFollowUp: boolean) => {
    const succeeded = await addActivity(bcn, outcome, activityNote.trim(), completeFollowUp && open ? open.id : undefined);
    if (!succeeded) return;
    setActivityNote("");
    toast.success(
      outcome === "contact" ? "Contact recorded" : "Attempt recorded",
      completeFollowUp && open ? { description: "Open follow-up marked complete." } : undefined,
    );
  };

  return (
    <>
      <Link
        to="/all-customers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All customers
      </Link>

      <PageHeader
        title={customer.customerName}
        description={`BCN ${customer.bcn} · MBCN ${customer.mbcn ?? "—"} · ${owner ? `Owner ${owner.name}` : "Unassigned"}`}
        actions={
          <div className="flex items-center gap-2">
            <TierBadge tier={customer.propensityTier} />
            <StatusBadge status={customer.status} />
            {!editable && (
              <Badge variant="outline" className="gap-1 border-transparent bg-muted text-muted-foreground">
                <Lock className="size-3" /> Read-only
              </Badge>
            )}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Next action</CardTitle>
            </CardHeader>
            <CardContent>
              {customer.status === "closed" ? (
                <p className="text-sm text-muted-foreground">
                  Closed — {customer.closureReason}. Reopen the customer to resume outreach.
                </p>
              ) : open ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Badge variant="outline" className="border-transparent bg-info/12 text-info">
                    {FOLLOWUP_LABEL[open.type]}
                  </Badge>
                  <span className="text-muted-foreground">
                    {open.dueAt ? dateTime(open.dueAt) : "No date set"}
                  </span>
                  {open.note && <span className="text-foreground">{open.note}</span>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No open follow-up.</p>
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="history">
            <TabsList>
              <TabsTrigger value="history">Interactions ({custActivities.length})</TabsTrigger>
              <TabsTrigger value="notes">Notes ({custNotes.length})</TabsTrigger>
              <TabsTrigger value="followups">Follow-ups ({custFollowUps.length})</TabsTrigger>
              <TabsTrigger value="master">Master data</TabsTrigger>
              <TabsTrigger value="ownership">Ownership</TabsTrigger>
            </TabsList>

            <TabsContent value="history" className="mt-4">
              <Card>
                <CardContent className="divide-y divide-border p-0">
                  {custActivities.length === 0 && (
                    <p className="p-6 text-sm text-muted-foreground">No interactions recorded in this app yet.</p>
                  )}
                  {custActivities.map((a) => (
                    <div key={a.id} className="flex gap-3 p-4">
                      <span
                        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
                          a.outcome === "contact" ? "bg-success/12 text-success" : "bg-warning/15 text-warning"
                        }`}
                      >
                        {a.outcome === "contact" ? <PhoneCall className="size-4" /> : <PhoneOff className="size-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {a.outcome === "contact" ? "Contact — call answered" : "Attempt — no answer"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {dateTime(a.at)} · {userName(a.userId)}
                        </p>
                        {a.note && <p className="mt-1.5 text-sm text-foreground/90">{a.note}</p>}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card>
                <CardContent className="divide-y divide-border p-0">
                  {custNotes.length === 0 && <p className="p-6 text-sm text-muted-foreground">No notes yet.</p>}
                  {custNotes.map((n) => (
                    <div key={n.id} className="flex gap-3 p-4">
                      <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-sm">{n.body}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {dateTime(n.at)} · {userName(n.userId)}
                        </p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="followups" className="mt-4">
              <Card>
                <CardContent className="divide-y divide-border p-0">
                  {custFollowUps.length === 0 && (
                    <p className="p-6 text-sm text-muted-foreground">No follow-ups recorded.</p>
                  )}
                  {custFollowUps.map((f) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                      <Badge variant="outline" className="border-transparent bg-secondary text-secondary-foreground">
                        {FOLLOWUP_LABEL[f.type]}
                      </Badge>
                      <span className="text-muted-foreground">{f.dueAt ? dateTime(f.dueAt) : "No date"}</span>
                      {f.note && <span>{f.note}</span>}
                      <span className="ml-auto text-xs">
                        {f.completedAt ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="size-3.5" /> Completed {shortDate(f.completedAt)}
                          </span>
                        ) : (
                          <span className="text-info">Open</span>
                        )}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="master" className="mt-4">
              <Card>
                <CardContent className="grid gap-x-8 gap-y-4 pt-6 sm:grid-cols-2">
                  <Field label="Phone numbers">
                    {customer.phones.map((p) => (
                      <div key={p.id} className="font-mono text-sm">
                        {p.number} {p.primary && <span className="text-xs text-muted-foreground">(primary)</span>}
                      </div>
                    ))}
                  </Field>
                  <Field label="Address">{customer.address ?? "—"}</Field>
                  <Field label="Propensity">
                    {customer.propensityScore} · tier {customer.propensityTier} · rank {customer.propensityRank}
                  </Field>
                  <Field label="Previously contacted (source)">
                    {customer.previouslyContacted ? "Yes" : "No"} · recent flag {customer.recent ? "true" : "false"}
                  </Field>
                  <Field label="Last purchase">{shortDate(customer.lastPurchaseDate)}</Field>
                  <Field label="Payment terms">{customer.paymentTerms ?? "—"}</Field>
                  <Field label="Revenue">
                    2024 {currency(customer.revenue[2024])} · 2025 {currency(customer.revenue[2025])} · 2026{" "}
                    {currency(customer.revenue[2026])}
                  </Field>
                  <Field label="FEM">
                    2024 {currency(customer.fem[2024])} · 2025 {currency(customer.fem[2025])} · 2026{" "}
                    {currency(customer.fem[2026])}
                  </Field>
                  <Field label="Sales organisation">
                    Inside lead {customer.insideLead ?? "—"} · Field rep {customer.fieldRep ?? "—"} · Inside rep{" "}
                    {customer.insideRep ?? "—"}
                  </Field>
                  <Field label="Branch / RSM / BU">
                    {customer.branchCode ?? "—"} · {customer.rsmName ?? "—"} · {customer.originatingBu ?? "—"}
                  </Field>
                  <Field label="Top vendors">
                    {customer.vendors.length
                      ? customer.vendors.map((v) => `${v.name} (${currency(v.revenue)})`).join(", ")
                      : "—"}
                  </Field>
                  <Field label="Top categories">
                    {customer.categories.length
                      ? customer.categories.map((v) => `${v.name} (${currency(v.revenue)})`).join(", ")
                      : "—"}
                  </Field>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ownership" className="mt-4">
              <Card>
                <CardContent className="divide-y divide-border p-0">
                  {custAssignments.length === 0 && (
                    <p className="p-6 text-sm text-muted-foreground">No assignment changes recorded.</p>
                  )}
                  {custAssignments.map((h) => (
                    <div key={h.id} className="p-4 text-sm">
                      <p>
                        {h.fromUserId ? userName(h.fromUserId) : "Unassigned"} →{" "}
                        {h.toUserId ? userName(h.toUserId) : "Unassigned"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {dateTime(h.at)} · {h.reason}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Record interaction</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={outcome} onValueChange={(v) => setOutcome(v as ActivityOutcome)} disabled={!editable}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contact">Contact — call answered</SelectItem>
                  <SelectItem value="attempt">Attempt — no answer</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Call note (optional)"
                value={activityNote}
                onChange={(e) => setActivityNote(e.target.value)}
                disabled={!editable}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!editable} onClick={() => logActivity(false)}>
                  Save activity
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!editable || !open}
                  onClick={() => logActivity(true)}
                >
                  Save &amp; complete follow-up
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Schedule follow-up</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={fuType} onValueChange={(v) => setFuType(v as FollowUpType)} disabled={!editable}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="appointment">Customer appointment</SelectItem>
                  <SelectItem value="reminder">Salesperson reminder</SelectItem>
                  <SelectItem value="needed">Follow-up needed (no date)</SelectItem>
                </SelectContent>
              </Select>
              {fuType !== "needed" && (
                <div className="space-y-1.5">
                  <Label htmlFor="due" className="text-xs text-muted-foreground">
                    Due date &amp; time
                  </Label>
                  <Input
                    id="due"
                    type="datetime-local"
                    value={fuDate}
                    onChange={(e) => setFuDate(e.target.value)}
                    disabled={!editable}
                    aria-invalid={dueError ? true : undefined}
                    aria-describedby={dueError ? "due-error" : undefined}
                  />
                  {dueError && (
                    <p id="due-error" role="alert" className="text-xs text-destructive">
                      {dueError}
                    </p>
                  )}
                </div>
              )}
              <Input
                placeholder="Follow-up note (optional)"
                value={fuNote}
                onChange={(e) => setFuNote(e.target.value)}
                disabled={!editable}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!editable || (fuType !== "needed" && !fuDate) || !!dueError}
                onClick={async () => {
                  const error = pastAppointmentError(fuType, fuDate); // time may have passed since render
                  if (error) {
                    toast.error(error);
                    return;
                  }
                  const succeeded = await addFollowUp(
                    bcn,
                    fuType,
                    fuType === "needed" ? null : new Date(fuDate).toISOString(),
                    fuNote.trim(),
                  );
                  if (!succeeded) return;
                  setFuNote("");
                  setFuDate("");
                  toast.success("Follow-up scheduled");
                }}
              >
                Add follow-up
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Add note</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Context, contacts, preferences…"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                disabled={!editable}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!editable || !noteBody.trim()}
                onClick={async () => {
                  const succeeded = await addNote(bcn, noteBody.trim());
                  if (!succeeded) return;
                  setNoteBody("");
                  toast.success("Note added");
                }}
              >
                Save note
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Lifecycle</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {customer.status === "closed" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!editable}
                  onClick={async () => {
                    const succeeded = await reopenCustomer(bcn);
                    if (succeeded) toast.success("Customer reopened");
                  }}
                >
                  <RotateCcw className="size-4" /> Reopen customer
                </Button>
              ) : (
                <>
                  <Select value={closeReasonId || activeReasons[0]?.id || ""} onValueChange={setCloseReasonId} disabled={!editable || activeReasons.length === 0}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeReasons.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!editable || activeReasons.length === 0}
                    onClick={async () => {
                      const reasonId = closeReasonId || activeReasons[0]?.id;
                      if (!reasonId) return;
                      const succeeded = await closeCustomer(bcn, reasonId);
                      if (succeeded) toast.success("Customer closed", { description: activeReasons.find((r) => r.id === reasonId)?.label });
                    }}
                  >
                    <XCircle className="size-4" /> Close customer
                  </Button>
                </>
              )}
              <Separator />
              <p className="text-xs text-muted-foreground">
                History is never overwritten. Closures, activities and follow-ups stay on the record.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}
