"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Typography } from "antd";
import { useServices } from "../../services/provider";
import type { Result, SampleRecord, Scenario, User } from "../../services/types";

const routes = [
  ["/dashboard", "Dashboard", "Sales"],
  ["/customers/mine", "My Customers", "Sales"],
  ["/customers", "All Customers", "Both"],
  ["/admin/users", "Users", "Admin"],
  ["/admin/closure-reasons", "Closure Reasons", "Admin"],
  ["/admin/import", "Excel Import", "Admin"],
  ["/admin/assignments", "Assignments", "Admin"],
  ["/admin/reports", "Reports", "Admin"],
  ["/admin/audit", "Audit", "Admin"],
] as const;
const landing = (user: User) => user.role === "Admin" ? "/customers" : "/dashboard";

function MockPanel() {
  const { controls } = useServices();
  const router = useRouter();
  const snapshot = useSyncExternalStore(controls.subscribe, controls.getSnapshot, controls.getSnapshot);
  return <fieldset>
    <legend>Mock controls — demonstration only</legend>
    <label htmlFor="scenario">Scenario</label>{" "}
    <select id="scenario" value={snapshot.scenario} onChange={event => {
      controls.setScenario(event.target.value as Scenario);
      if (event.target.value === "Expired session") router.replace("/login");
    }}>
      {["Normal", "Loading", "Empty", "Error", "Expired session"].map(value => <option key={value}>{value}</option>)}
    </select>{" "}
    <button onClick={() => { controls.reset(); router.replace("/login"); }}>Reset mock state</button>
    <p>Selected scenario: {snapshot.scenario}</p>
  </fieldset>;
}

function SignIn() {
  const { services, controls } = useServices();
  const [persona, setPersona] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);
  // Unmounting on reset or session changes prevents late sign-in UI updates.
  async function submit() {
    if (pending) return;
    if (!persona) { setError("Select a persona to sign in."); return; }
    setPending(true); setError(""); setRetry(false);
    const result = await services.signIn(persona);
    setPending(false);
    if (!result.ok) { setError(result.error.message); setRetry(result.error.code === "request-failure"); }
  }
  return <>
    <Typography.Title level={1}>Call Center</Typography.Title>
    <h2>Sign in</h2>
    <p>Mock prototype — choose a synthetic persona. No real account is needed.</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="persona">Persona</label>{" "}
      <select id="persona" value={persona} disabled={pending} aria-describedby={error ? "signin-error" : undefined} onChange={event => setPersona(event.target.value)}>
        <option value="">Select a persona</option>
        {controls.personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name} ({persona.role})</option>)}
      </select>{" "}
      <button disabled={pending} type="submit">Sign in</button>
      {pending && <p role="status">Signing in…</p>}
      {error && <p id="signin-error" role="alert">{error}</p>}
      {retry && <button type="button" disabled={pending} onClick={() => void submit()}>Retry</button>}
    </form>
  </>;
}

function SamplePanel() {
  const { services } = useServices();
  const [result, setResult] = useState<Result<SampleRecord[]> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void services.sampleRecords().then(value => { if (active) setResult(value); });
    return () => { active = false; };
  }, [services, attempt]);
  return <section aria-label="Mock service status">
    <h2>Mock service status</h2>
    <p>Synthetic demonstration records only; these are not customer lists or workload calculations.</p>
    {!result ? <p role="status">Loading sample records…</p> : !result.ok ? <>
      <p role="alert">{result.error.message}</p>
      <button onClick={() => { setResult(null); setAttempt(attempt + 1); }}>Retry</button>
    </> : result.data.length === 0 ? <p>No sample records.</p> : <ul>{result.data.map(record => <li key={record.id}>{record.label}</li>)}</ul>}
  </section>;
}

export default function Home() {
  const { services, controls, user } = useServices();
  const pathname = usePathname();
  const router = useRouter();
  const snapshot = useSyncExternalStore(controls.subscribe, controls.getSnapshot, controls.getSnapshot);
  const route = routes.find(([path]) => path === pathname);
  const login = pathname === "/login" || pathname === "/";
  const redirect = login && user ? landing(user) : (login && pathname === "/") || (route && !user) ? "/login" : null;
  useEffect(() => { if (redirect) router.replace(redirect); }, [redirect, router]);

  return <main>
    <MockPanel />
    {snapshot.notice && <p role="alert">{snapshot.notice}</p>}
    {redirect ? <p role="status">Returning to {user ? "your workspace" : "sign-in"}…</p> : login ? <SignIn key={snapshot.notice + snapshot.reset} /> : !route ? <>
      <h1>Page not found</h1><Link href={user ? landing(user) : "/login"}>Return to {user ? "your workspace" : "sign-in"}</Link>
    </> : user && <>
      <header><p>{user.name} · {user.role}</p><button onClick={() => void services.signOut()}>Log out</button></header>
      <nav aria-label="Main navigation">{routes.filter(([, , role]) => role === "Both" || role === user.role).map(([path, title]) => <Link key={path} href={path} aria-current={path === pathname ? "page" : undefined}>{title}</Link>)}</nav>
      {route[2] === "Admin" && user.role !== "Admin" ? <><h1>Access denied</h1><p>This page requires the Admin role.</p><Link href="/dashboard">Back to Dashboard</Link></> : <>
        <h1>{route[1]}</h1><p>Placeholder — this functionality is not implemented yet.</p>
        <SamplePanel key={`${user.id}:${pathname}:${snapshot.revision}`} />
      </>}
    </>}
  </main>;
}
