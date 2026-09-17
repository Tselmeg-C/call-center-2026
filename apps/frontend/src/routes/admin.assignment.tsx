import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown, ChevronUp, Pencil, Play, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { User } from "@/lib/types";
import type { AssignmentRule, ConditionOperator, RuleCondition } from "@/services/types";

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

// -- Condition field/operator metadata --------------------------------------------------------
// Mirrors apps/api/assignment_rules.py's CONDITION_FIELDS/allowed_operators exactly (see also
// _docs/assignment.md). `customer.status` and `owner_id` are deliberately never offered here.
type FieldKind = "text" | "numeric" | "boolean" | "date";

const TEXT_FIELDS = [
  "bcn", "mbcn", "name", "propensity_tier", "inside_lead", "field_rep", "sc_naming",
  "inside_rep", "branch_code", "rsm_name", "originating_bu", "payment_terms",
] as const;
const NUMERIC_FIELDS = [
  "propensity_score", "propensity_rank",
  "revenue_amount_2024", "revenue_amount_2025", "revenue_amount_2026",
  "fem_amount_2024", "fem_amount_2025", "fem_amount_2026",
] as const;
const BOOLEAN_FIELDS = ["previously_contacted", "recent"] as const;
const DATE_FIELDS = ["last_purchase_date"] as const;

export const CONDITION_FIELDS: readonly string[] = [...TEXT_FIELDS, ...NUMERIC_FIELDS, ...BOOLEAN_FIELDS, ...DATE_FIELDS];

export const FIELD_LABELS: Record<string, string> = {
  bcn: "BCN", mbcn: "MBCN", name: "Customer name", propensity_tier: "Propensity tier",
  inside_lead: "Inside lead", field_rep: "Field rep", sc_naming: "SC naming", inside_rep: "Inside rep",
  branch_code: "Branch code", rsm_name: "RSM name", originating_bu: "Originating BU", payment_terms: "Payment terms",
  propensity_score: "Propensity score", propensity_rank: "Propensity rank",
  revenue_amount_2024: "Revenue (2024)", revenue_amount_2025: "Revenue (2025)", revenue_amount_2026: "Revenue (2026)",
  fem_amount_2024: "FEM amount (2024)", fem_amount_2025: "FEM amount (2025)", fem_amount_2026: "FEM amount (2026)",
  previously_contacted: "Previously contacted", recent: "Recent",
  last_purchase_date: "Last purchase date",
};

const FIELD_KIND: Record<string, FieldKind> = Object.fromEntries([
  ...TEXT_FIELDS.map((field) => [field, "text" as const]),
  ...NUMERIC_FIELDS.map((field) => [field, "numeric" as const]),
  ...BOOLEAN_FIELDS.map((field) => [field, "boolean" as const]),
  ...DATE_FIELDS.map((field) => [field, "date" as const]),
]);

export const fieldKind = (field: string): FieldKind => FIELD_KIND[field] ?? "text";

const OPERATORS_BY_KIND: Record<FieldKind, ConditionOperator[]> = {
  text: ["=", "!=", "contains", "in", "is-null", "is-not-null"],
  numeric: ["=", "!=", "<", "<=", ">", ">=", "between", "is-null", "is-not-null"],
  date: ["=", "!=", "<", "<=", ">", ">=", "between", "is-null", "is-not-null"],
  boolean: ["=", "!=", "is-null", "is-not-null"],
};

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  "=": "equals", "!=": "not equals", contains: "contains", in: "is one of",
  "is-null": "is empty", "is-not-null": "is not empty",
  "<": "less than", "<=": "at most", ">": "greater than", ">=": "at least", between: "between",
};

// -- Condition draft (form-local state) --------------------------------------------------------
// One flat shape holds every operator's value slot (scalar/list/bounds/boolean) so controlled
// inputs never need to be conditionally mounted/unmounted; draftToCondition only reads the slot
// that matters for the chosen operator.
type ConditionDraft = {
  key: string;
  field: string;
  operator: ConditionOperator;
  value: string;
  values: string[];
  low: string;
  high: string;
  bool: boolean;
};

const blankValues = () => ({ value: "", values: [] as string[], low: "", high: "", bool: false });

export function blankConditionDraft(): ConditionDraft {
  const field = CONDITION_FIELDS[0]!;
  return { key: crypto.randomUUID(), field, operator: OPERATORS_BY_KIND[fieldKind(field)][0]!, ...blankValues() };
}

export function conditionToDraft(condition: RuleCondition): ConditionDraft {
  const kind = fieldKind(condition.field);
  const draft: ConditionDraft = { key: crypto.randomUUID(), field: condition.field, operator: condition.operator, ...blankValues() };
  if (condition.operator === "in" && Array.isArray(condition.value)) {
    draft.values = condition.value as string[];
  } else if (condition.operator === "between" && Array.isArray(condition.value)) {
    const [low, high] = condition.value as [string, string];
    draft.low = String(low);
    draft.high = String(high);
  } else if (kind === "boolean") {
    draft.bool = condition.value === true;
  } else if (condition.value !== null && condition.value !== undefined) {
    draft.value = String(condition.value);
  }
  return draft;
}

/** Validates + shapes one condition draft exactly like apps/api/assignment_rules.py's
 *  `validate_condition` (required bounds, low <= high, non-empty `in` list, ...), so the form can
 *  block a bad `between`/empty value locally instead of round-tripping a 422. */
/** A new rule starts with one blank condition to fill in; an existing rule starts with exactly its
 *  saved conditions -- none for a zero-condition rule, so its "matches every customer" warning
 *  shows and it can be saved without touching conditions. */
export function initialConditionDrafts(rule?: AssignmentRule): ConditionDraft[] {
  return rule ? rule.conditions.map(conditionToDraft) : [blankConditionDraft()];
}

export function draftToCondition(draft: ConditionDraft): { condition: RuleCondition } | { error: string } {
  const kind = fieldKind(draft.field);
  const operator = draft.operator;
  if (operator === "is-null" || operator === "is-not-null") return { condition: { field: draft.field, operator, value: null } };
  if (operator === "in") {
    const values = draft.values.map((item) => item.trim()).filter(Boolean);
    if (!values.length) return { error: "Add at least one value." };
    return { condition: { field: draft.field, operator, value: values } };
  }
  if (operator === "between") {
    const low = draft.low.trim();
    const high = draft.high.trim();
    if (!low || !high) return { error: "Both bounds are required." };
    if (kind === "numeric") {
      const lowNumber = Number(low);
      const highNumber = Number(high);
      if (Number.isNaN(lowNumber) || Number.isNaN(highNumber)) return { error: "Enter valid numbers for both bounds." };
      if (lowNumber > highNumber) return { error: "The low bound must not exceed the high bound." };
    } else if (low > high) {
      return { error: "The low bound must not exceed the high bound." };
    }
    return { condition: { field: draft.field, operator, value: [low, high] } };
  }
  if (kind === "boolean") return { condition: { field: draft.field, operator, value: draft.bool } };
  const value = draft.value.trim();
  if (!value) return { error: "A value is required." };
  if (kind === "numeric" && Number.isNaN(Number(value))) return { error: "Enter a number." };
  return { condition: { field: draft.field, operator, value } };
}

export function describeCondition(condition: RuleCondition): string {
  const label = FIELD_LABELS[condition.field] ?? condition.field;
  const opLabel = OPERATOR_LABELS[condition.operator] ?? condition.operator;
  if (condition.operator === "is-null" || condition.operator === "is-not-null") return `${label} ${opLabel}`;
  if (condition.operator === "between" && Array.isArray(condition.value)) return `${label} ${opLabel} ${condition.value[0]} and ${condition.value[1]}`;
  if (condition.operator === "in" && Array.isArray(condition.value)) return `${label} ${opLabel} ${condition.value.join(", ")}`;
  if (typeof condition.value === "boolean") return `${label} ${condition.operator === "=" ? "is" : "is not"} ${condition.value ? "true" : "false"}`;
  return `${label} ${opLabel} ${condition.value}`;
}

// -- Overlap detection (#71) --------------------------------------------------------------------
// UI warning only: matching stays first-match-wins by position (apps/api/assignment_rules.py).
// Two rules "may overlap" unless some pair of their conditions on the same field provably can never
// both match one value, using evaluate_condition's semantics. Anything not provably disjoint
// (e.g. two `contains`, two `!=`) counts as a possible overlap, so the warning errs on the side of
// showing.
// ponytail: ignores contradictions inside a single rule (e.g. `score < 1 AND score > 5`), so such a
// rule can still be reported as overlapping; add intra-rule range merging if that proves noisy.
type Range = { lo: number; loInc: boolean; hi: number; hiInc: boolean };

function toRange(condition: RuleCondition): Range | null {
  const kind = fieldKind(condition.field);
  const num = (v: unknown) => (kind === "date" ? Date.parse(String(v)) : Number(v));
  const v = condition.value;
  switch (condition.operator) {
    case "=": return { lo: num(v), loInc: true, hi: num(v), hiInc: true };
    case "<": return { lo: -Infinity, loInc: true, hi: num(v), hiInc: false };
    case "<=": return { lo: -Infinity, loInc: true, hi: num(v), hiInc: true };
    case ">": return { lo: num(v), loInc: false, hi: Infinity, hiInc: true };
    case ">=": return { lo: num(v), loInc: true, hi: Infinity, hiInc: true };
    case "between": return Array.isArray(v) ? { lo: num(v[0]), loInc: true, hi: num(v[1]), hiInc: true } : null;
    default: return null;
  }
}

const rangesDisjoint = (a: Range, b: Range) =>
  a.hi < b.lo || b.hi < a.lo || (a.hi === b.lo && !(a.hiInc && b.loInc)) || (b.hi === a.lo && !(b.hiInc && a.loInc));

/** True when no single customer value can satisfy both conditions (same field assumed). */
export function conditionsDisjoint(a: RuleCondition, b: RuleCondition): boolean {
  const aNull = a.operator === "is-null";
  const bNull = b.operator === "is-null";
  if (aNull || bNull) return aNull !== bNull; // only is-null matches null; every other operator needs a value
  if (a.operator === "is-not-null" || b.operator === "is-not-null") return false;

  const kind = fieldKind(a.field);
  if (kind === "boolean") {
    const target = (c: RuleCondition) => (c.operator === "=" ? c.value === true : c.value !== true);
    return target(a) !== target(b);
  }
  if (kind === "text") {
    const set = (c: RuleCondition) => (c.operator === "=" ? [String(c.value)] : c.operator === "in" && Array.isArray(c.value) ? c.value.map(String) : null);
    const [setA, setB] = [set(a), set(b)];
    if (setA && setB) return !setA.some((item) => setB.includes(item));
    const [values, other] = setA ? [setA, b] : setB ? [setB, a] : [null, null];
    if (!values || !other) return false; // contains/!= against contains/!= -- can't prove disjoint
    if (other.operator === "!=") return values.every((item) => item === other.value);
    if (other.operator === "contains") return values.every((item) => !item.toLowerCase().includes(String(other.value).toLowerCase()));
    return false;
  }
  // numeric / date
  const [rangeA, rangeB] = [toRange(a), toRange(b)];
  if (rangeA && rangeB) return rangesDisjoint(rangeA, rangeB);
  const [point, other] = a.operator === "!=" ? [rangeB, a] : b.operator === "!=" ? [rangeA, b] : [null, null];
  if (!point || !other) return false; // != against !=
  const excluded = toRange({ ...other, operator: "=" })!;
  return point.loInc && point.hiInc && point.lo === point.hi && point.lo === excluded.lo;
}

/** True unless some same-field condition pair makes the two rules mutually exclusive. */
export function rulesMayOverlap(a: RuleCondition[], b: RuleCondition[]): boolean {
  return !a.some((ca) => b.some((cb) => ca.field === cb.field && conditionsDisjoint(ca, cb)));
}

/** Priority order, same as PostgreSQL ordered_rules(): `order`, then `id` for rules sharing one. */
export function sortByPriority<T extends Pick<AssignmentRule, "id" | "order">>(rules: readonly T[]): T[] {
  return rules.slice().sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// A 409 from POST/PATCH /admin/assignment-rules is either a duplicate name or a stale `version`
// (see apps/api/main.py's create_assignment_rule/update_assignment_rule); services/http.ts and
// services/mock.ts both surface the backend's own detail text as the error message, so branching
// on it here is exact, not a guess.
export const isDuplicateNameConflict = (message: string) => message.toLowerCase().includes("already exist");
export const isStaleVersionConflict = (message: string) => message.toLowerCase().includes("stale");

function AdminAssignment() {
  const {
    customers,
    users,
    assignmentRules,
    assignmentHistory,
    runAssignment,
    reassign,
    toggleRule,
    moveRule,
  } = useStore();
  const [manualBcn, setManualBcn] = useState("");
  const [manualOwner, setManualOwner] = useState("");
  const [editing, setEditing] = useState<{ mode: "create" } | { mode: "edit"; rule: AssignmentRule } | null>(null);

  const unassigned = customers.filter((c) => !c.ownerId && c.status !== "closed");
  const salesUsers = users.filter((u) => u.role === "sales" && u.active);
  const userName = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : "Unassigned");
  const sortedRules = sortByPriority(assignmentRules);

  const closeForm = () => setEditing(null);

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
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">Assignment rules</CardTitle>
              {!editing && (
                <Button size="sm" variant="secondary" onClick={() => setEditing({ mode: "create" })}>
                  <Plus className="size-4" /> Add rule
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {editing?.mode === "create" && (
                <RuleForm mode="create" salesUsers={salesUsers} allUsers={users} onCancel={closeForm} onSaved={closeForm} />
              )}

              {sortedRules.length === 0 && !editing && (
                <p className="text-sm text-muted-foreground">
                  No assignment rules yet. Unassigned customers use the balanced-workload fallback.
                </p>
              )}

              {sortedRules.map((rule, index) => {
                if (editing?.mode === "edit" && editing.rule.id === rule.id) {
                  return (
                    <RuleForm
                      key={rule.id}
                      mode="edit"
                      rule={rule}
                      salesUsers={salesUsers}
                      allUsers={users}
                      onCancel={closeForm}
                      onSaved={closeForm}
                    />
                  );
                }
                return (
                  <div key={rule.id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant="outline" className="border-transparent bg-secondary font-mono text-secondary-foreground">
                        #{rule.order}
                      </Badge>
                      <div className="min-w-48 flex-1">
                        <p className="text-sm font-medium">{rule.name}</p>
                        {rule.conditions.length === 0 ? (
                          <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                            <AlertTriangle className="size-3.5" /> Matches every customer (no conditions)
                          </p>
                        ) : (
                          <p className="font-mono text-xs text-muted-foreground">
                            {rule.conditions.map(describeCondition).join(" AND ")}
                          </p>
                        )}
                        {rule.active && (() => {
                          const shadowedBy = sortedRules.slice(0, index).filter((other) => other.active && rulesMayOverlap(other.conditions, rule.conditions));
                          return shadowedBy.length > 0 ? (
                            <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                              <AlertTriangle className="size-3.5 shrink-0" /> May overlap with higher-priority{" "}
                              {shadowedBy.map((other) => `#${other.order} ${other.name}`).join(", ")}; customers matching both go to the earlier rule.
                            </p>
                          ) : null;
                        })()}
                        <p className="mt-1 text-xs text-muted-foreground">
                          Eligible: {rule.memberIds.length ? rule.memberIds.map((id) => userName(id)).join(", ") : "None"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Move ${rule.name} up in priority`}
                          disabled={!!editing || index === 0}
                          onClick={() => void moveRule(rule.id, "up")}
                        >
                          <ChevronUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Move ${rule.name} down in priority`}
                          disabled={!!editing || index === sortedRules.length - 1}
                          onClick={() => void moveRule(rule.id, "down")}
                        >
                          <ChevronDown className="size-4" />
                        </Button>
                      </div>
                      <Button type="button" size="sm" variant="outline" disabled={!!editing} onClick={() => setEditing({ mode: "edit", rule })}>
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                      <div className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{rule.active ? "Active" : "Inactive"}</span>
                        <Switch
                          checked={rule.active}
                          disabled={!!editing}
                          onCheckedChange={() => void toggleRule(rule.id)}
                          aria-label={`${rule.active ? "Deactivate" : "Activate"} ${rule.name}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* No delete control by design -- the API has no delete endpoint for assignment
                  rules (see issue #40); deactivating (the Switch above) is the only removal path. */}
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

function RuleForm({
  mode,
  rule,
  salesUsers,
  allUsers,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  rule?: AssignmentRule;
  salesUsers: User[];
  allUsers: User[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { assignmentRules, createAssignmentRule, updateAssignmentRule, refreshAssignmentRules } = useStore();
  const [name, setName] = useState(rule?.name ?? "");
  const [conditions, setConditions] = useState<ConditionDraft[]>(() => initialConditionDrafts(rule));
  const [memberIds, setMemberIds] = useState<string[]>(rule?.memberIds ?? []);
  const [active, setActive] = useState(rule?.active ?? true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [conditionErrors, setConditionErrors] = useState<Record<string, string>>({});
  const [staleConflict, setStaleConflict] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The eligible-members picker must offer only active Sales users, but per _docs/assignment.md
  // a member who was active-Sales when added and has since changed is "silently skipped, not
  // removed from storage" -- so an unrelated edit (e.g. renaming the rule) must not quietly drop
  // them from the picker. Show them too, flagged, instead of silently losing that membership.
  const noActiveSalesUsers = salesUsers.length === 0;

  // Live overlap warning (#71): only once every condition row is complete and valid (zero rows is a
  // valid catch-all), so a half-filled form doesn't warn against every active rule.
  const draftResults = conditions.map(draftToCondition);
  const draftConditions = draftResults.flatMap((result) => ("condition" in result ? [result.condition] : []));
  const overlapping =
    active && draftConditions.length === draftResults.length
      ? sortByPriority(assignmentRules).filter((other) => other.active && other.id !== rule?.id && rulesMayOverlap(other.conditions, draftConditions))
      : [];
  const pickableUsers = [...salesUsers, ...allUsers.filter((u) => memberIds.includes(u.id) && !salesUsers.some((s) => s.id === u.id))];

  const submit = async () => {
    setGeneralError(null);
    setStaleConflict(false);

    let hasError = false;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Name is required.");
      hasError = true;
    } else {
      setNameError(null);
    }

    const nextConditionErrors: Record<string, string> = {};
    const validConditions: RuleCondition[] = [];
    for (const draft of conditions) {
      const result = draftToCondition(draft);
      if ("error" in result) {
        nextConditionErrors[draft.key] = result.error;
        hasError = true;
      } else {
        validConditions.push(result.condition);
      }
    }
    setConditionErrors(nextConditionErrors);

    if (!memberIds.length) {
      setMembersError("Select at least one eligible member.");
      hasError = true;
    } else {
      setMembersError(null);
    }

    if (hasError) return;

    setSubmitting(true);
    const payload = { name: trimmedName, conditions: validConditions, memberIds, active };
    const result = mode === "create" ? await createAssignmentRule(payload) : await updateAssignmentRule(rule!.id, payload);
    setSubmitting(false);

    if (result.ok) {
      toast.success(mode === "create" ? "Rule created" : "Rule saved");
      onSaved();
      return;
    }

    if (result.error.code === "conflict" && isDuplicateNameConflict(result.error.message)) {
      setNameError("This name is already in use.");
      return;
    }
    if (result.error.code === "conflict" && isStaleVersionConflict(result.error.message)) {
      setStaleConflict(true);
      return;
    }
    if (result.error.code === "validation" && result.error.message.toLowerCase().includes("member")) {
      setMembersError(result.error.message);
      return;
    }
    // Network/5xx and any other failure: the form (and everything typed into it) stays open --
    // nothing above resets `name`/`conditions`/`memberIds`/`active` -- so Save can simply be
    // retried once the underlying problem is fixed.
    setGeneralError(result.error.message);
  };

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{mode === "create" ? "Add rule" : `Edit rule: ${rule?.name}`}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {staleConflict && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>This rule changed elsewhere</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>Reload to see the latest before saving your changes.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void refreshAssignmentRules().then(onCancel)}>
                Reload
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {generalError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Could not save</AlertTitle>
            <AlertDescription>{generalError} You can try again.</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1">
          <Label htmlFor="rule-name">Rule name</Label>
          <Input
            id="rule-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? "rule-name-error" : undefined}
          />
          {nameError && (
            <p id="rule-name-error" role="alert" className="text-xs text-destructive">
              {nameError}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Conditions (all of the following must match)</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => setConditions((prev) => [...prev, blankConditionDraft()])}>
              <Plus className="size-4" /> Add condition
            </Button>
          </div>
          {conditions.length === 0 && (
            <p className="flex items-center gap-1.5 text-sm text-warning">
              <AlertTriangle className="size-4" /> No conditions: this rule will match every customer.
            </p>
          )}
          <div className="space-y-2">
            {conditions.map((draft, index) => (
              <ConditionEditor
                key={draft.key}
                draft={draft}
                index={index}
                error={conditionErrors[draft.key]}
                onChange={(next) => setConditions((prev) => prev.map((item) => (item.key === draft.key ? next : item)))}
                onRemove={() => setConditions((prev) => prev.filter((item) => item.key !== draft.key))}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <span id="members-label" className="text-sm font-medium">
            Eligible members
          </span>
          {noActiveSalesUsers ? (
            <p role="alert" className="text-sm text-destructive">
              No active Sales users are available to assign. Activate a Sales user before saving a rule.
            </p>
          ) : (
            <div className="space-y-1.5" role="group" aria-labelledby="members-label">
              {pickableUsers.map((user) => {
                const inactive = !salesUsers.some((s) => s.id === user.id);
                const checked = memberIds.includes(user.id);
                const id = `member-${user.id}`;
                return (
                  <div key={user.id} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(value) =>
                        setMemberIds((prev) => (value === true ? [...prev, user.id] : prev.filter((item) => item !== user.id)))
                      }
                    />
                    <Label htmlFor={id}>
                      {user.name}
                      {inactive ? " (inactive)" : ""}
                    </Label>
                  </div>
                );
              })}
            </div>
          )}
          {membersError && (
            <p role="alert" className="text-xs text-destructive">
              {membersError}
            </p>
          )}
        </div>

        {overlapping.length > 0 && (
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertTitle>May overlap with other active rules</AlertTitle>
            <AlertDescription>
              A customer could match both this rule and{" "}
              {overlapping.map((other) => `#${other.order} ${other.name}`).join(", ")}
              . Only the rule earliest in priority order assigns them.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2">
          <Switch id="rule-active" checked={active} onCheckedChange={setActive} />
          <Label htmlFor="rule-active">Active</Label>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button type="button" onClick={() => void submit()} disabled={submitting || noActiveSalesUsers}>
            {submitting ? "Saving…" : mode === "create" ? "Create rule" : "Save changes"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConditionEditor({
  draft,
  index,
  error,
  onChange,
  onRemove,
}: {
  draft: ConditionDraft;
  index: number;
  error: string | undefined;
  onChange: (next: ConditionDraft) => void;
  onRemove: () => void;
}) {
  const kind = fieldKind(draft.field);
  const operators = OPERATORS_BY_KIND[kind];
  const idBase = `condition-${draft.key}`;

  const handleFieldChange = (nextField: string) => {
    const nextOperators = OPERATORS_BY_KIND[fieldKind(nextField)];
    const nextOperator = nextOperators.includes(draft.operator) ? draft.operator : nextOperators[0]!;
    onChange({ key: draft.key, field: nextField, operator: nextOperator, ...blankValues() });
  };

  const handleOperatorChange = (nextOperator: ConditionOperator) => {
    onChange({ ...draft, ...blankValues(), operator: nextOperator });
  };

  return (
    <div className="rounded-md border border-border p-3" role="group" aria-label={`Condition ${index + 1}`}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${idBase}-field`}>Field</Label>
          <Select value={draft.field} onValueChange={handleFieldChange}>
            <SelectTrigger id={`${idBase}-field`} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONDITION_FIELDS.map((field) => (
                <SelectItem key={field} value={field}>
                  {FIELD_LABELS[field] ?? field}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${idBase}-operator`}>Operator</Label>
          <Select value={draft.operator} onValueChange={(value) => handleOperatorChange(value as ConditionOperator)}>
            <SelectTrigger id={`${idBase}-operator`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operators.map((op) => (
                <SelectItem key={op} value={op}>
                  {OPERATOR_LABELS[op]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {draft.operator === "is-null" || draft.operator === "is-not-null" ? null : draft.operator === "between" ? (
          <>
            <div className="space-y-1">
              <Label htmlFor={`${idBase}-low`}>Low</Label>
              <Input
                id={`${idBase}-low`}
                type={kind === "date" ? "date" : "number"}
                value={draft.low}
                onChange={(e) => onChange({ ...draft, low: e.target.value })}
                className="w-36"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idBase}-high`}>High</Label>
              <Input
                id={`${idBase}-high`}
                type={kind === "date" ? "date" : "number"}
                value={draft.high}
                onChange={(e) => onChange({ ...draft, high: e.target.value })}
                className="w-36"
              />
            </div>
          </>
        ) : draft.operator === "in" ? (
          <InValuesEditor idBase={idBase} values={draft.values} onChange={(values) => onChange({ ...draft, values })} />
        ) : kind === "boolean" ? (
          <div className="flex items-center gap-2">
            <Switch id={`${idBase}-value`} checked={draft.bool} onCheckedChange={(checked) => onChange({ ...draft, bool: checked })} />
            <Label htmlFor={`${idBase}-value`}>{draft.bool ? "True" : "False"}</Label>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor={`${idBase}-value`}>Value</Label>
            <Input
              id={`${idBase}-value`}
              type={kind === "date" ? "date" : kind === "numeric" ? "number" : "text"}
              value={draft.value}
              onChange={(e) => onChange({ ...draft, value: e.target.value })}
              className="w-48"
            />
          </div>
        )}

        <Button type="button" size="icon" variant="ghost" aria-label={`Remove condition ${index + 1}`} onClick={onRemove}>
          <X className="size-4" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function InValuesEditor({ idBase, values, onChange }: { idBase: string; values: string[]; onChange: (values: string[]) => void }) {
  const [draftValue, setDraftValue] = useState("");
  const addValue = () => {
    const trimmed = draftValue.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraftValue("");
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={`${idBase}-in-value`}>Values</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`${idBase}-in-value`}
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue();
            }
          }}
          className="w-40"
        />
        <Button type="button" size="sm" variant="secondary" onClick={addValue}>
          Add value
        </Button>
      </div>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {values.map((value, index) => (
            <li key={`${value}-${index}`}>
              <Badge variant="outline" className="gap-1 border-transparent bg-secondary text-secondary-foreground">
                {value}
                <button type="button" aria-label={`Remove value ${value}`} onClick={() => onChange(values.filter((_, i) => i !== index))} className="cursor-pointer">
                  <X className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
