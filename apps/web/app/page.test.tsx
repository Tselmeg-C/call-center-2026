import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "./page";

test("renders the application landing page", () => {
  render(<Home />);

  const main = screen.getByRole("main");
  expect(within(main).getByRole("heading", { level: 1, name: "Call Center" })).toBeVisible();
  expect(within(main).getByText("Customer-contact management workspace.")).toBeVisible();
});
