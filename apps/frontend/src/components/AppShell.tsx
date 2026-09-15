import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  ClipboardList,
  Database,
  LayoutDashboard,
  LogOut,
  PhoneCall,
  ScrollText,
  Upload,
  Users,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

const salesNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/my-customers", label: "My Customers", icon: ClipboardList },
  { to: "/all-customers", label: "All Customers", icon: Database },
] as const;

const adminNav = [
  { to: "/admin/users", label: "Users & Roles", icon: Users },
  { to: "/admin/import", label: "Excel Import", icon: Upload },
  { to: "/admin/assignment", label: "Assignment", icon: Workflow },
  { to: "/admin/reports", label: "Reporting", icon: BarChart3 },
  { to: "/admin/audit", label: "Audit Log", icon: ScrollText },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { currentUser, signOut } = useStore();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <PhoneCall className="size-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Northrail Outreach</p>
            <p className="text-[11px] text-sidebar-foreground/60">Customer contact desk</p>
          </div>
        </div>

        <nav className="flex-1 space-y-6 px-3 py-2">
          <NavGroup title="Sales">
            {salesNav.map((item) => (
              <NavLink key={item.to} {...item} exact={item.to === "/"} />
            ))}
          </NavGroup>
          {currentUser.role === "admin" && (
            <NavGroup title="Administration">
              {adminNav.map((item) => (
                <NavLink key={item.to} {...item} />
              ))}
            </NavGroup>
          )}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <p className="px-2 pb-1.5 text-[11px] uppercase tracking-wide text-sidebar-foreground/50">
            Signed in as
          </p>
          <div className="flex items-center gap-2 rounded-md bg-sidebar-accent px-2.5 py-2 text-sidebar-accent-foreground">
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{currentUser.name}</p>
              <p className="text-[11px] text-sidebar-accent-foreground/60">{currentUser.role}</p>
            </div>
            <Button size="icon" variant="ghost" className="size-7 shrink-0" title="Sign out" onClick={signOut}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden">
          <span className="text-sm font-semibold">Northrail Outreach</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {[...salesNav, ...(currentUser.role === "admin" ? adminNav : [])].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground"
                activeProps={{ className: "rounded-md px-2 py-1 text-xs bg-secondary text-foreground" }}
                activeOptions={{ exact: item.to === "/" }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  exact,
}: {
  to: string;
  label: string;
  icon: typeof Users;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: exact ?? false }}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      activeProps={{
        className:
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium bg-sidebar-accent text-sidebar-accent-foreground",
      }}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
