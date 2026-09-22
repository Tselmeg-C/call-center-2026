import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppShell } from "../components/AppShell";
import { StoreProvider } from "@/lib/store";
import { ServiceProvider, useSession } from "@/services/provider";
import { Toaster } from "../components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  console.error(normalizedError);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(normalizedError, { boundary: "tanstack_root_error_component" });
  }, [normalizedError]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Northrail Customer Contact Desk" },
      {
        name: "description",
        content:
          "Internal contact desk for enterprise sales: assigned customers, call logging, follow-ups and admin reporting.",
      },
      { property: "og:title", content: "Northrail Customer Contact Desk" },
      {
        property: "og:description",
        content: "Manage assigned customers, record calls, schedule follow-ups and report on outreach.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/** #121: which route, if any, a given session/location combination must be redirected to.
 *  Pure and exported so it's directly testable without rendering -- a signed-out visitor away
 *  from /login always goes to /login, a signed-in visitor sitting on /login is bounced to /,
 *  everything else stays put. */
export function authRedirectTarget(signedIn: boolean, onLoginRoute: boolean): "/login" | "/" | null {
  if (!signedIn) return onLoginRoute ? null : "/login";
  return onLoginRoute ? "/" : null;
}

/** Gate everything behind session state from the service layer (see _docs/authentication.md):
 *  signed out visitors only ever see /login, and a signed-in visitor is bounced away from it.
 *
 *  #121: this used to render a declarative `<Navigate>` for the redirect. That leaves the app on
 *  a blank page after sign-out (and after any 401 that flips the session to null mid-tab, see
 *  services/http.ts) -- rendering `<Navigate>` unmounts the authenticated view immediately, but
 *  its own effect-driven navigation doesn't reliably follow through. Driving the same redirect
 *  explicitly via `router.navigate` here -- the one place every unauthenticated state (sign-out,
 *  session expiry, a revoked session) already funnels through -- fixes it at the root instead of
 *  in each caller, and also means Back into a now-stale authenticated URL re-triggers this same
 *  effect rather than re-rendering cached authenticated content. */
function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();
  const router = useRouter();
  const onLoginRoute = location.pathname === "/login";
  const redirectTo = loading ? null : authRedirectTarget(!!user, onLoginRoute);

  useEffect(() => {
    if (redirectTo) void router.navigate({ to: redirectTo, replace: true });
  }, [redirectTo, router]);

  if (loading || redirectTo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        {loading ? "Loading…" : null}
      </div>
    );
  }
  if (!user) return <>{children}</>;
  return (
    <StoreProvider>
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ServiceProvider>
        <AuthGate>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </AuthGate>
        <Toaster />
      </ServiceProvider>
    </QueryClientProvider>
  );
}
