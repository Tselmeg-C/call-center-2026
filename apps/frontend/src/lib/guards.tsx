import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";

/** Wrap an Admin-only route's rendered content. A Sales session that reaches an admin URL
 *  directly (bookmark, typed URL, bypassed nav) is bounced to the dashboard; the backend also
 *  independently rejects the underlying requests with 403 regardless of this client check. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { currentUser } = useStore();
  if (currentUser.role !== "admin") return <Navigate to="/" />;
  return <>{children}</>;
}
