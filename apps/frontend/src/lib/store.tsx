import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useServices, useSession } from "@/services/provider";
import type {
  AssignmentRule,
  AssignmentRuleDraft,
  AssignmentRulePatch,
  ClosureReason,
  Customer as ServiceCustomer,
  Result,
  Services,
  UserDraft,
} from "@/services/types";
import {
  fromFollowUpType,
  newSubmissionId,
  toActivities,
  toAssignmentEvents,
  toCustomer,
  toFollowUp,
  toNotes,
  toUser,
} from "@/lib/adapt";
import type {
  Activity,
  ActivityOutcome,
  AssignmentEvent,
  AuditEntry,
  Customer,
  FollowUp,
  FollowUpType,
  ImportJob,
  Note,
  User,
} from "./types";

type Ctx = {
  currentUser: User;
  users: User[];
  customers: Customer[];
  activities: Activity[];
  notes: Note[];
  followUps: FollowUp[];
  assignmentHistory: AssignmentEvent[];
  auditLog: AuditEntry[];
  importJobs: ImportJob[];
  assignmentRules: AssignmentRule[];
  closureReasons: ClosureReason[];
  canWork: (c: Customer) => boolean;
  signOut: () => void;
  addActivity: (bcn: string, outcome: ActivityOutcome, note: string, followUpId?: string) => Promise<boolean>;
  addNote: (bcn: string, body: string) => Promise<boolean>;
  addFollowUp: (bcn: string, type: FollowUpType, dueAt: string | null, note: string) => Promise<boolean>;
  closeCustomer: (bcn: string, reasonId: string) => Promise<boolean>;
  reopenCustomer: (bcn: string) => Promise<boolean>;
  reassign: (bcn: string, toUserId: string | null, reason: string) => Promise<boolean>;
  runAssignment: () => Promise<{ assigned: number }>;
  toggleUserActive: (id: string) => Promise<boolean>;
  resetUserPassword: (id: string, password: string) => Promise<boolean>;
  /** #119: returns the raw Result (rather than toasting) so the Add user form can show a
   *  duplicate-email 409 inline instead of losing what was typed. */
  createUser: (input: UserDraft) => Promise<Result<User>>;
  toggleRule: (id: string) => Promise<boolean>;
  /** Up/down reordering via `swapRuleOrder`: two version-checked PATCHes sent one after the other.
   *  On failure it toasts and resyncs rules + assignment version from the server. */
  moveRule: (id: string, direction: "up" | "down") => Promise<boolean>;
  createAssignmentRule: (input: AssignmentRuleDraft) => Promise<Result<AssignmentRule>>;
  /** Used by the rule editor to save name/conditions/memberIds/active changes; always attaches
   *  the last-loaded assignment version so a concurrent edit elsewhere surfaces as a 409 instead
   *  of silently overwriting it. Returns the raw Result (rather than toasting) so the form can
   *  show the specific inline error -- duplicate name, stale version, etc. */
  updateAssignmentRule: (id: string, patch: Omit<AssignmentRulePatch, "version">) => Promise<Result<AssignmentRule>>;
  refreshAssignmentRules: () => Promise<void>;
  recordImport: (file: File) => Promise<ImportJob | null>;
};

const StoreContext = createContext<Ctx | null>(null);

export type RuleSwapOutcome =
  | { ok: true; updated: [AssignmentRule, AssignmentRule]; version: number }
  | { ok: false; message: string; rules: AssignmentRule[] | null; version: number | null };

/** Swaps two rules' order. The backend compare-and-swaps the shared assignment version on every
 *  PATCH (+1 per success), so the two PATCHes must run sequentially, each with the version the
 *  previous one produced -- concurrent ones race and 409. On any failure (a half-applied swap
 *  included) the rules and version are refetched so the caller can match server state.
 *
 *  #116: when current and neighbor already share the same `order` (post-#103, ties break by id),
 *  swapping the two equal values back is a no-op -- Move up/down would appear to do nothing. In
 *  that case, bump whichever one should end up further down so the pair gets distinct orders and
 *  actually changes position; a distinct-order pair still gets the plain swap as before. */
export async function swapRuleOrder(
  services: Pick<Services, "updateAssignmentRule" | "listAssignmentRules" | "getAssignmentVersion">,
  current: AssignmentRule,
  neighbor: AssignmentRule,
  version: number,
  direction: "up" | "down",
): Promise<RuleSwapOutcome> {
  const tied = current.order === neighbor.order;
  const currentOrder = tied ? (direction === "down" ? current.order + 1 : current.order) : neighbor.order;
  const neighborOrder = tied ? (direction === "up" ? neighbor.order + 1 : neighbor.order) : current.order;
  const first = await services.updateAssignmentRule(current.id, { order: currentOrder, version });
  if (first.ok) {
    const second = await services.updateAssignmentRule(neighbor.id, { order: neighborOrder, version: version + 1 });
    if (second.ok) return { ok: true, updated: [first.data, second.data], version: version + 2 };
    return resync(services, second.error.message);
  }
  return resync(services, first.error.message);
}

async function resync(services: Pick<Services, "listAssignmentRules" | "getAssignmentVersion">, message: string): Promise<RuleSwapOutcome> {
  const [rulesResult, versionResult] = await Promise.all([services.listAssignmentRules(), services.getAssignmentVersion()]);
  return {
    ok: false,
    message: message || "Could not reorder rules.",
    rules: rulesResult.ok ? rulesResult.data : null,
    version: versionResult.ok ? versionResult.data : null,
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { user: sessionUser } = useSession();
  const [serviceCustomers, setServiceCustomers] = useState<ServiceCustomer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [closureReasons, setClosureReasons] = useState<ClosureReason[]>([]);
  const [rules, setRules] = useState<AssignmentRule[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  // Not reactive state on purpose: it's only ever read/written synchronously inside the mutation
  // helpers below (including back-to-back within moveRule), and a useState value read from a
  // closure captured before a prior await resolves would still see the pre-mutation number.
  const assignmentVersion = useRef(1);

  const isAdmin = sessionUser?.role === "Admin";

  useEffect(() => {
    if (!sessionUser) return;
    let active = true;
    void services.listCustomers({ page_size: 100 }).then((result) => {
      if (active && result.ok) setServiceCustomers(result.data.items);
    });
    void services.listClosureReasons().then((result) => {
      if (active && result.ok) setClosureReasons(result.data);
    });
    if (isAdmin) {
      void services.listUsers().then((result) => {
        if (active && result.ok) setUsers(result.data.map(toUser));
      });
      void services.listAssignmentRules().then((result) => {
        if (active && result.ok) setRules(result.data);
      });
      void services.getAssignmentVersion().then((result) => {
        if (active && result.ok) assignmentVersion.current = result.data;
      });
      void services.audit({ page_size: 100 }).then((result) => {
        if (active && result.ok) {
          setAuditLog(result.data.items.map((event) => ({ id: event.id, at: event.timestamp, actorId: event.actorId, action: event.action, target: event.target, ...(Object.keys(event.details).length ? { detail: JSON.stringify(event.details) } : {}) })));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [sessionUser, isAdmin, services]);

  // Sales sessions can't call the Admin-only /admin/users listing (correctly, per contract), so
  // they get a "known users" set built from what customer ownership already tells them plus
  // themselves. Good enough for owner-name display and filters on Sales-facing screens.
  const effectiveUsers = useMemo<User[]>(() => {
    if (isAdmin) return users;
    const known = new Map<string, User>();
    if (sessionUser) known.set(sessionUser.id, toUser(sessionUser));
    for (const customer of serviceCustomers) {
      if (customer.ownerId && customer.ownerName && !known.has(customer.ownerId)) {
        known.set(customer.ownerId, { id: customer.ownerId, name: customer.ownerName, email: "", role: "sales", active: true });
      }
    }
    return [...known.values()];
  }, [isAdmin, users, sessionUser, serviceCustomers]);

  const customers = useMemo(() => serviceCustomers.map(toCustomer), [serviceCustomers]);
  const activities = useMemo(() => serviceCustomers.flatMap(toActivities), [serviceCustomers]);
  const notes = useMemo(() => serviceCustomers.flatMap(toNotes), [serviceCustomers]);
  const followUps = useMemo(
    () => serviceCustomers.flatMap((customer) => customer.followUps.filter((item) => item.status !== "Cancelled").map(toFollowUp)),
    [serviceCustomers],
  );
  const assignmentHistory = useMemo(() => serviceCustomers.flatMap(toAssignmentEvents), [serviceCustomers]);

  const replaceCustomer = (updated: ServiceCustomer) =>
    setServiceCustomers((prev) => prev.map((item) => (item.bcn === updated.bcn ? updated : item)));

  const reportError = (message: string) => toast.error(message);

  const canWork = (c: Customer) => !!sessionUser && (sessionUser.role === "Admin" || c.ownerId === sessionUser.id);

  const addActivity: Ctx["addActivity"] = async (bcn, outcome, note, followUpId) => {
    const serviceOutcome = outcome === "contact" ? "Contact" : "Attempt";
    const result = followUpId
      ? await services.completeFollowUp(bcn, followUpId, { outcome: serviceOutcome, note: note || null, submissionId: newSubmissionId() })
      : await services.createInteraction(bcn, { outcome: serviceOutcome, note: note || null, submissionId: newSubmissionId() });
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    const refreshed = await services.getCustomer(bcn);
    if (refreshed.ok) replaceCustomer(refreshed.data);
    return true;
  };

  const addNote: Ctx["addNote"] = async (bcn, body) => {
    const result = await services.createNote(bcn, { text: body, submissionId: newSubmissionId() });
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    const refreshed = await services.getCustomer(bcn);
    if (refreshed.ok) replaceCustomer(refreshed.data);
    return true;
  };

  const addFollowUp: Ctx["addFollowUp"] = async (bcn, type, dueAt, note) => {
    const result = await services.createFollowUp(bcn, { type: fromFollowUpType(type), due: dueAt, note: note || "Follow-up", submissionId: newSubmissionId() });
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    const refreshed = await services.getCustomer(bcn);
    if (refreshed.ok) replaceCustomer(refreshed.data);
    return true;
  };

  const closeCustomer: Ctx["closeCustomer"] = async (bcn, reasonId) => {
    const result = await services.closeCustomer(bcn, { reasonId, submissionId: newSubmissionId() });
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    replaceCustomer(result.data);
    return true;
  };

  const reopenCustomer: Ctx["reopenCustomer"] = async (bcn) => {
    const result = await services.reopenCustomer(bcn, { submissionId: newSubmissionId() });
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    replaceCustomer(result.data);
    return true;
  };

  const reassign: Ctx["reassign"] = async (bcn, toUserId) => {
    const target = serviceCustomers.find((item) => item.bcn === bcn);
    const result = await services.assignCustomer(bcn, toUserId, newSubmissionId(), target?.version);
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    replaceCustomer(result.data);
    return true;
  };

  const runAssignment: Ctx["runAssignment"] = async () => {
    const result = await services.runAssignments("unassigned", newSubmissionId());
    if (!result.ok) {
      reportError(result.error.message);
      return { assigned: 0 };
    }
    const refreshed = await services.listCustomers({ page_size: 100 });
    if (refreshed.ok) setServiceCustomers(refreshed.data.items);
    return { assigned: result.data.assigned };
  };

  const toggleUserActive: Ctx["toggleUserActive"] = async (id) => {
    const target = users.find((item) => item.id === id);
    if (!target) return false;
    const result = await services.updateUser(id, { active: !target.active });
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    setUsers((prev) => prev.map((item) => (item.id === id ? toUser(result.data) : item)));
    const refreshed = await services.listCustomers({ page_size: 100 });
    if (refreshed.ok) setServiceCustomers(refreshed.data.items);
    return true;
  };

  const resetUserPassword: Ctx["resetUserPassword"] = async (id, password) => {
    const result = await services.resetUserPassword(id, password);
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    setUsers((prev) => prev.map((item) => (item.id === id ? toUser(result.data) : item)));
    return true;
  };

  const createUser: Ctx["createUser"] = async (input) => {
    const result = await services.createUser(input);
    if (!result.ok) return result;
    const created = toUser(result.data);
    setUsers((prev) => [...prev, created]);
    return { ok: true, data: created };
  };

  const toggleRule: Ctx["toggleRule"] = async (id) => {
    const target = rules.find((item) => item.id === id);
    if (!target) return false;
    const result = await services.updateAssignmentRule(id, { active: !target.active });
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    setRules((prev) => prev.map((item) => (item.id === id ? result.data : item)));
    assignmentVersion.current += 1;
    return true;
  };

  const moveRule: Ctx["moveRule"] = async (id, direction) => {
    const sorted = [...rules].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((item) => item.id === id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return false;
    const current = sorted[index]!;
    const neighbor = sorted[swapIndex]!;
    const outcome = await swapRuleOrder(services, current, neighbor, assignmentVersion.current, direction);
    if (!outcome.ok) {
      reportError(outcome.message);
      if (outcome.rules) setRules(outcome.rules);
      if (outcome.version !== null) assignmentVersion.current = outcome.version;
      return false;
    }
    const [currentData, neighborData] = outcome.updated;
    setRules((prev) =>
      prev
        .map((item) => (item.id === current.id ? currentData : item.id === neighbor.id ? neighborData : item))
        .sort((a, b) => a.order - b.order),
    );
    assignmentVersion.current = outcome.version;
    return true;
  };

  const createAssignmentRule: Ctx["createAssignmentRule"] = async (input) => {
    const result = await services.createAssignmentRule(input);
    if (result.ok) {
      setRules((prev) => [...prev, result.data].sort((a, b) => a.order - b.order));
      assignmentVersion.current += 1;
    }
    return result;
  };

  const updateAssignmentRule: Ctx["updateAssignmentRule"] = async (id, patch) => {
    const result = await services.updateAssignmentRule(id, { ...patch, version: assignmentVersion.current });
    if (result.ok) {
      setRules((prev) => prev.map((item) => (item.id === id ? result.data : item)).sort((a, b) => a.order - b.order));
      assignmentVersion.current += 1;
    }
    return result;
  };

  const refreshAssignmentRules: Ctx["refreshAssignmentRules"] = async () => {
    const [rulesResult, versionResult] = await Promise.all([services.listAssignmentRules(), services.getAssignmentVersion()]);
    if (rulesResult.ok) setRules(rulesResult.data);
    if (versionResult.ok) assignmentVersion.current = versionResult.data;
  };

  const recordImport: Ctx["recordImport"] = async (file) => {
    const result = await services.importWorkbook(file, newSubmissionId());
    if (!result.ok) {
      reportError(result.error.message);
      return null;
    }
    const job: ImportJob = {
      id: result.data.jobId,
      fileName: result.data.filename,
      at: result.data.completedAt,
      rowsProcessed: result.data.processed,
      created: result.data.created,
      updated: result.data.updated,
      errors: result.data.errors.map((item) => `Row ${item.row}: ${item.reason}`),
    };
    setImportJobs((prev) => [job, ...prev]);
    const refreshed = await services.listCustomers({ page_size: 100 });
    if (refreshed.ok) setServiceCustomers(refreshed.data.items);
    return job;
  };

  const value: Ctx | null = sessionUser
    ? {
        currentUser: toUser(sessionUser),
        users: effectiveUsers,
        customers,
        activities,
        notes,
        followUps,
        assignmentHistory,
        auditLog,
        importJobs,
        assignmentRules: rules,
        closureReasons,
        canWork,
        signOut: () => void services.logout(),
        addActivity,
        addNote,
        addFollowUp,
        closeCustomer,
        reopenCustomer,
        reassign,
        runAssignment,
        toggleUserActive,
        resetUserPassword,
        createUser,
        toggleRule,
        moveRule,
        createAssignmentRule,
        updateAssignmentRule,
        refreshAssignmentRules,
        recordImport,
      }
    : null;

  if (!value) return null;
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
