import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useServices, useSession } from "@/services/provider";
import type { AssignmentRule as ServiceRule, ClosureReason, Customer as ServiceCustomer } from "@/services/types";
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

type UiAssignmentRule = { id: string; name: string; priority: number; conditions: string; eligible: string[]; active: boolean };

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
  assignmentRules: UiAssignmentRule[];
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
  toggleRule: (id: string) => Promise<boolean>;
  recordImport: (file: File) => Promise<ImportJob | null>;
};

const StoreContext = createContext<Ctx | null>(null);

const ruleReasonText = (rule: ServiceRule) => `Assigns to ${rule.ownerId} while active (order ${rule.order})`;

export function StoreProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { user: sessionUser } = useSession();
  const [serviceCustomers, setServiceCustomers] = useState<ServiceCustomer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [closureReasons, setClosureReasons] = useState<ClosureReason[]>([]);
  const [rules, setRules] = useState<ServiceRule[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

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
  const assignmentRules = useMemo<UiAssignmentRule[]>(
    () => rules.map((rule) => ({ id: rule.id, name: rule.name, priority: rule.order, conditions: ruleReasonText(rule), eligible: [rule.ownerId], active: rule.active })),
    [rules],
  );

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

  const toggleRule: Ctx["toggleRule"] = async (id) => {
    const target = rules.find((item) => item.id === id);
    if (!target) return false;
    const result = await services.updateAssignmentRule(id, { active: !target.active });
    if (!result.ok) {
      reportError(result.error.message);
      return false;
    }
    setRules((prev) => prev.map((item) => (item.id === id ? result.data : item)));
    return true;
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
        assignmentRules,
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
        toggleRule,
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
