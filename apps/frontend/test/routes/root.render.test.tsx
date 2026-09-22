// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { MOCK_PASSWORD } from "@/services/mock";

// #121 (QA follow-up): root.test.ts and http.test.ts only exercise the redirect *decision*
// (authRedirectTarget) and the 401-session mechanism -- neither one renders anything, so neither
// proves a login form actually appears on screen. This test does: it renders the real app
// (VITE_SERVICE_MODE unset here, same as local dev -> in-memory mock services) through a real
// TanStack Router instance, signs in and out through the actual DOM, and asserts the login form
// is what ends up on screen after sign-out -- the same thing QA checked by hand in a browser.
//
// Scoped to jsdom via the file-local `@vitest-environment` pragma above rather than switching
// vitest.config.ts's suite-wide `environment: "node"` (see that file), so every other test file
// keeps running fast with no DOM. `jsdom` is the only new dependency; nothing else in the repo
// needed a DOM/testing-library before this, so this stays hand-rolled (react-dom/client + plain
// DOM queries) instead of adding @testing-library/react for one test file.

// jsdom doesn't implement scrollTo, and doesn't flag itself as an act()-compatible environment
// by default; both are test-harness plumbing, unrelated to the app code under test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderApp() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<RouterProvider router={router} />);
  });
  return {
    container,
    cleanup: () => {
      root.unmount();
      container.remove();
    },
  };
}

// Router navigation and the mock services' session notification each chain a few promise ticks
// (login -> notifySession -> AuthGate's effect -> router.navigate -> matches commit), so one
// macrotask isn't always enough for everything to settle.
async function flush(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("sign-out renders the login form (#121)", () => {
  let originalConsoleError: typeof console.error;
  let consoleErrors: unknown[][];

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("shows the login form again after signing out, with no console errors along the way", async () => {
    originalConsoleError = console.error;
    consoleErrors = [];
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };

    const { container, cleanup } = await renderApp();
    try {
      // Signed out on load: the login form is what renders.
      expect(container.querySelector("input#email")).not.toBeNull();
      expect(container.querySelector('button[type="submit"]')?.textContent).toContain("Sign in");

      setInputValue(container.querySelector("input#email")!, "alex@example.test");
      setInputValue(container.querySelector("input#password")!, MOCK_PASSWORD);
      await act(async () => {
        container.querySelector("form")!.requestSubmit();
        await flush();
      });

      // Signed in: AuthGate redirects off /login, so the app shell (with its sign-out control)
      // renders instead of the login form.
      const signOutButton = container.querySelector<HTMLButtonElement>('button[title="Sign out"]');
      expect(signOutButton).not.toBeNull();
      expect(container.querySelector("input#email")).toBeNull();

      await act(async () => {
        signOutButton!.click();
        await flush();
      });

      // The original #121 bug: sign-out revoked the session but left a blank page instead of
      // landing back on the login form. Assert the form -- not a blank container -- is present.
      expect(container.querySelector("input#email")).not.toBeNull();
      expect(container.querySelector('button[type="submit"]')?.textContent).toContain("Sign in");
      expect(container.querySelector('button[title="Sign out"]')).toBeNull();

      // The sequencing bug this PR also fixes: sign-out used to throw a caught-and-recovered
      // "useStore must be used inside StoreProvider" while the route tree unmounted. (Not
      // asserting zero console output overall -- React's "not wrapped in act(...)" warnings are
      // this hand-rolled harness's own noise, unrelated to app behavior.)
      const messages = consoleErrors.map((args) => String(args[0]));
      expect(messages.some((message) => message.includes("useStore must be used inside StoreProvider"))).toBe(false);
    } finally {
      cleanup();
    }
  });
});
