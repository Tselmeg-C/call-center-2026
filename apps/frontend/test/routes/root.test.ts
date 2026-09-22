import { describe, expect, it } from "vitest";
import { authRedirectTarget } from "@/routes/__root";

// #121: sign-out left a blank page because AuthGate rendered a declarative <Navigate> whose
// effect-driven navigation didn't reliably fire. The fix drives the same redirect decision
// through an explicit router.navigate call instead; this exercises the decision itself (this
// project's vitest setup has no DOM/testing-library -- see admin.assignment.test.ts -- so the
// route's exported pure logic is what's directly testable without rendering).
describe("authRedirectTarget", () => {
  it("sends a signed-out visitor on any other route to /login", () => {
    expect(authRedirectTarget(false, false)).toBe("/login");
  });

  it("leaves a signed-out visitor already on /login alone (the login form renders)", () => {
    expect(authRedirectTarget(false, true)).toBeNull();
  });

  it("bounces a signed-in visitor sitting on /login to /", () => {
    expect(authRedirectTarget(true, true)).toBe("/");
  });

  it("leaves a signed-in visitor on any other route alone", () => {
    expect(authRedirectTarget(true, false)).toBeNull();
  });
});
