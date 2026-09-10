import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import Home from "./[[...path]]/page";
import { ServiceProvider } from "../services/provider";

const nav = vi.hoisted(() => ({ path: "/login", replace: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ replace: nav.replace }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
beforeEach(() => { nav.path = "/login"; nav.replace.mockReset(); });
function setup() {
  const view = render(<ServiceProvider><Home /></ServiceProvider>);
  return (path: string) => { nav.path = path; view.rerender(<ServiceProvider><Home /></ServiceProvider>); };
}
async function signIn(id = "sales-river") {
  fireEvent.change(screen.getByLabelText("Persona"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(id === "admin-demo" ? "/customers" : "/dashboard"));
}
function scenario(value: string) { fireEvent.change(screen.getByLabelText("Scenario"), { target: { value } }); }

test("validates sign-in, selects role navigation and removes content after logout/back", async () => {
  const go = setup();
  expect(screen.getByRole("heading", { name: "Call Center" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Select a persona");
  await signIn(); go("/dashboard");
  expect(await screen.findByText("River Sales's synthetic service record")).toBeVisible();
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  go("/customers"); expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  go("/login"); await signIn("admin-demo"); go("/customers");
  expect(screen.getByText("Alex Admin · Admin")).toBeVisible();
  expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/admin/users");
});

test("direct protected routes redirect, all Admin routes deny Sales, unknown paths recover", async () => {
  nav.path = "/admin/users"; const go = setup();
  expect(screen.queryByRole("heading", { name: "Users" })).not.toBeInTheDocument();
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
  go("/login"); await signIn();
  for (const path of ["users", "closure-reasons", "import", "assignments", "reports", "audit"]) {
    go(`/admin/${path}`);
    expect(screen.getByRole("heading", { name: "Access denied" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("region", { name: "Mock service status" })).not.toBeInTheDocument();
  }
  go("/missing"); expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Return to your workspace" })).toHaveAttribute("href", "/dashboard");
});

test("sign-in and read errors retry; Loading, Empty, expiry and reset are reproducible", async () => {
  const go = setup(); scenario("Error");
  fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "sales-sky" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("mock request failed");
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
  go("/dashboard"); expect(await screen.findByText("Sky Sales's synthetic service record")).toBeVisible();
  scenario("Empty"); expect(await screen.findByText("No sample records.")).toBeVisible();
  scenario("Loading"); expect(screen.getByRole("status")).toHaveTextContent("Loading");
  expect(screen.queryByText("No sample records.")).not.toBeInTheDocument();
  scenario("Normal"); expect(await screen.findByText("Sky Sales's synthetic service record")).toBeVisible();
  scenario("Error"); expect(await screen.findByRole("alert")).toHaveTextContent("mock request failed");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Sky Sales's synthetic service record")).toBeVisible();
  scenario("Loading"); scenario("Expired session");
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  go("/login"); expect(screen.getByRole("alert")).toHaveTextContent("Your session expired. Sign in again.");
  scenario("Normal"); await signIn(); go("/dashboard");
  fireEvent.click(screen.getByRole("button", { name: "Reset mock state" })); go("/login");
  expect(screen.getByLabelText("Scenario")).toHaveValue("Normal");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await signIn(); go("/dashboard");
  expect(await screen.findByText("River Sales's synthetic service record")).toBeVisible();
});

test("pending sign-in prevents duplicates and can be reset or released without stale identity", async () => {
  const go = setup(); scenario("Loading");
  fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "sales-river" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reset mock state" }));
  await act(async () => {});
  expect(nav.replace).toHaveBeenCalledWith("/login");
  expect(screen.getByLabelText("Persona")).toHaveValue("");
  scenario("Loading");
  fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "sales-river" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" })); scenario("Normal");
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
  go("/dashboard"); expect(await screen.findByText("River Sales's synthetic service record")).toBeVisible();
});

test("every Admin destination has the matching heading, active link and service panel", async () => {
  const go = setup(); await signIn("admin-demo"); go("/customers");
  const links = screen.getAllByRole("link").map(link => [link.getAttribute("href")!, link.textContent!]);
  expect(links).toHaveLength(7);
  for (const [path, title] of links) {
    go(path);
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByRole("link", { name: title })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/Placeholder/)).toBeVisible();
    expect(await screen.findByText("Alex Admin's synthetic service record")).toBeVisible();
  }
});
