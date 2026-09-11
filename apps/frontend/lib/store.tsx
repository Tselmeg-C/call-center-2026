import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import * as seed from "./seed";
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

const uid = () => Math.random().toString(36).slice(2, 10);

type Ctx = {
  currentUser: User;
  setCurrentUserId: (id: string) => void;
  users: User[];
  customers: Customer[];
  activities: Activity[];
  notes: Note[];
  followUps: FollowUp[];
  assignmentHistory: AssignmentEvent[];
  auditLog: AuditEntry[];
  importJobs: ImportJob[];
  assignmentRules: typeof seed.assignmentRules;
  canWork: (c: Customer) => boolean;
  addActivity: (bcn: string, outcome: ActivityOutcome, note: string, followUpId?: string) => void;
  addNote: (bcn: string, body: string) => void;
  addFollowUp: (bcn: string, type: FollowUpType, dueAt: string | null, note: string) => void;
  closeCustomer: (bcn: string, reason: string) => void;
  reopenCustomer: (bcn: string) => void;
  reassign: (bcn: string, toUserId: string | null, reason: string) => void;
  runAssignment: () => { assigned: number };
  toggleUserActive: (id: string) => void;
  toggleRule: (id: string) => void;
  recordImport: (fileName: string) => ImportJob;
};

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [currentUserId, setCurrentUserId] = useState("u2");
  const [users, setUsers] = useState<User[]>(seed.users);
  const [customers, setCustomers] = useState<Customer[]>(seed.customers);
  const [activities, setActivities] = useState<Activity[]>(seed.activities);
  const [notes, setNotes] = useState<Note[]>(seed.notes);
  const [followUps, setFollowUps] = useState<FollowUp[]>(seed.followUps);
  const [assignmentHistory, setAssignmentHistory] = useState<AssignmentEvent[]>(seed.assignmentHistory);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(seed.auditLog);
  const [importJobs, setImportJobs] = useState<ImportJob[]>(seed.importJobs);
  const [assignmentRules, setAssignmentRules] = useState(seed.assignmentRules);

  const currentUser = users.find((u) => u.id === currentUserId) ?? users[0]!;

  const audit = useCallback(
    (action: string, target: string, detail?: string) =>
      setAuditLog((prev) => [
        {
          id: uid(),
          at: new Date().toISOString(),
          actorId: currentUserId,
          action,
          target,
          ...(detail ? { detail } : {}),
        },
        ...prev,
      ]),
    [currentUserId],
  );

  const canWork = useCallback(
    (c: Customer) => currentUser.role === "admin" || c.ownerId === currentUser.id,
    [currentUser],
  );

  const addActivity = useCallback<Ctx["addActivity"]>((bcn, outcome, note, followUpId) => {
    const at = new Date().toISOString();
    setActivities((prev) => [{ id: uid(), bcn, outcome, at, userId: currentUserId, ...(note ? { note } : {}) }, ...prev]);
    setCustomers((prev) =>
      prev.map((c) =>
        c.bcn === bcn && c.status !== "closed"
          ? { ...c, status: outcome === "contact" ? "contacted" : c.status === "contacted" ? "contacted" : "attempted" }
          : c,
      ),
    );
    if (followUpId) {
      setFollowUps((prev) => prev.map((f) => (f.id === followUpId ? { ...f, completedAt: at } : f)));
    }
  }, [currentUserId]);

  const addNote = useCallback<Ctx["addNote"]>((bcn, body) => {
    setNotes((prev) => [{ id: uid(), bcn, at: new Date().toISOString(), userId: currentUserId, body }, ...prev]);
  }, [currentUserId]);

  const addFollowUp = useCallback<Ctx["addFollowUp"]>((bcn, type, dueAt, note) => {
    setFollowUps((prev) => [
      { id: uid(), bcn, type, dueAt, userId: currentUserId, ...(note ? { note } : {}) },
      ...prev,
    ]);
  }, [currentUserId]);

  const closeCustomer = useCallback<Ctx["closeCustomer"]>((bcn, reason) => {
    setCustomers((prev) => prev.map((c) => (c.bcn === bcn ? { ...c, status: "closed", closureReason: reason } : c)));
    audit("Customer closed", bcn, reason);
  }, [audit]);

  const reopenCustomer = useCallback<Ctx["reopenCustomer"]>((bcn) => {
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.bcn !== bcn) return c;
        const hasContact = seed.activities.some((a) => a.bcn === bcn && a.outcome === "contact");
        return { ...c, closureReason: undefined, status: hasContact ? "contacted" : "attempted" };
      }),
    );
    audit("Customer reopened", bcn);
  }, [audit]);

  const reassign = useCallback<Ctx["reassign"]>((bcn, toUserId, reason) => {
    setCustomers((prev) => {
      const target = prev.find((c) => c.bcn === bcn);
      if (target) {
        setAssignmentHistory((h) => [
          { id: uid(), bcn, fromUserId: target.ownerId, toUserId, at: new Date().toISOString(), reason },
          ...h,
        ]);
      }
      return prev.map((c) => (c.bcn === bcn ? { ...c, ownerId: toUserId } : c));
    });
    audit("Ownership changed", bcn, reason);
  }, [audit]);

  const runAssignment = useCallback<Ctx["runAssignment"]>(() => {
    let assigned = 0;
    const eligible = users.filter((u) => u.role === "sales" && u.active);
    setCustomers((prev) => {
      const load = new Map(eligible.map((u) => [u.id, prev.filter((c) => c.ownerId === u.id && c.status !== "closed").length]));
      const next = prev.map((c) => {
        if (c.ownerId || c.status === "closed") return c;
        const rule = assignmentRules
          .filter((r) => r.active)
          .sort((a, b) => a.priority - b.priority)
          .find((r) => r.conditions.includes("propensity_tier = A") && c.propensityTier === "A");
        const pool = rule ? rule.eligible.filter((id) => load.has(id)) : eligible.map((u) => u.id);
        if (!pool.length) return c;
        const winner = pool.sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0]!;
        load.set(winner, (load.get(winner) ?? 0) + 1);
        assigned += 1;
        setAssignmentHistory((h) => [
          {
            id: uid(),
            bcn: c.bcn,
            fromUserId: null,
            toUserId: winner,
            at: new Date().toISOString(),
            reason: rule ? `Rule: ${rule.name}` : "Balanced workload fallback",
          },
          ...h,
        ]);
        return { ...c, ownerId: winner };
      });
      return next;
    });
    audit("Assignment run", "Unassigned customers");
    return { assigned };
  }, [assignmentRules, audit, users]);

  const toggleUserActive = useCallback<Ctx["toggleUserActive"]>((id) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, active: !u.active } : u)));
    setCustomers((prev) => {
      const user = users.find((u) => u.id === id);
      if (!user || !user.active) return prev;
      return prev.map((c) => (c.ownerId === id && c.status !== "closed" ? { ...c, ownerId: null } : c));
    });
    const user = users.find((u) => u.id === id);
    audit(user?.active ? "User deactivated" : "User activated", user?.name ?? id);
  }, [audit, users]);

  const toggleRule = useCallback<Ctx["toggleRule"]>((id) => {
    setAssignmentRules((prev) => prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r)));
    audit("Assignment rule changed", id);
  }, [audit]);

  const recordImport = useCallback<Ctx["recordImport"]>((fileName) => {
    const rows = 800 + Math.floor(Math.random() * 600);
    const created = Math.floor(Math.random() * 25);
    const job: ImportJob = {
      id: uid(),
      fileName,
      at: new Date().toISOString(),
      rowsProcessed: rows,
      created,
      updated: rows - created - 2,
      errors: ["Row 118: missing bcn", "Row 664: duplicate bcn in file"],
    };
    setImportJobs((prev) => [job, ...prev]);
    audit("Import completed", fileName, `${rows} rows / ${created} created`);
    return job;
  }, [audit]);

  const value = useMemo<Ctx>(
    () => ({
      currentUser,
      setCurrentUserId,
      users,
      customers,
      activities,
      notes,
      followUps,
      assignmentHistory,
      auditLog,
      importJobs,
      assignmentRules,
      canWork,
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
    }),
    [
      currentUser,
      users,
      customers,
      activities,
      notes,
      followUps,
      assignmentHistory,
      auditLog,
      importJobs,
      assignmentRules,
      canWork,
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
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
