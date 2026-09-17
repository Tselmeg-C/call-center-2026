import { describe, expect, it } from "vitest";
import {
  CONDITION_FIELDS,
  blankConditionDraft,
  conditionToDraft,
  conditionsDisjoint,
  describeCondition,
  draftToCondition,
  fieldKind,
  initialConditionDrafts,
  isDuplicateNameConflict,
  isStaleVersionConflict,
  rulesMayOverlap,
} from "@/routes/admin.assignment";
import type { RuleCondition } from "@/services/types";

// These exercise the builder's client-side condition validation/type-gating and shaping --
// covering the same rules as apps/api/assignment_rules.py's validate_condition (see
// _docs/assignment.md) without needing to render the route (no DOM/testing-library in this
// project's vitest setup; see vitest.config.ts's node environment).

describe("admin assignment: field/operator metadata", () => {
  it("only offers the backend's authoritative condition fields, never customer.status or owner_id", () => {
    expect(CONDITION_FIELDS).toContain("propensity_tier");
    expect(CONDITION_FIELDS).toContain("last_purchase_date");
    expect(CONDITION_FIELDS).not.toContain("customer.status");
    expect(CONDITION_FIELDS).not.toContain("owner_id");
  });

  it("classifies each field by the same kind apps/api/assignment_rules.py uses", () => {
    expect(fieldKind("bcn")).toBe("text");
    expect(fieldKind("propensity_score")).toBe("numeric");
    expect(fieldKind("previously_contacted")).toBe("boolean");
    expect(fieldKind("last_purchase_date")).toBe("date");
  });
});

describe("admin assignment: draftToCondition", () => {
  it("requires a value for a plain text condition", () => {
    const draft = { ...blankConditionDraft(), field: "name", operator: "=" as const };
    expect(draftToCondition(draft)).toEqual({ error: "A value is required." });
    expect(draftToCondition({ ...draft, value: "Acme" })).toEqual({ condition: { field: "name", operator: "=", value: "Acme" } });
  });

  it("needs no value at all for is-null/is-not-null", () => {
    const draft = { ...blankConditionDraft(), field: "last_purchase_date", operator: "is-null" as const };
    expect(draftToCondition(draft)).toEqual({ condition: { field: "last_purchase_date", operator: "is-null", value: null } });
  });

  it("takes a true/false value for boolean fields, never free text", () => {
    const draft = { ...blankConditionDraft(), field: "recent", operator: "=" as const, bool: true };
    expect(draftToCondition(draft)).toEqual({ condition: { field: "recent", operator: "=", value: true } });
  });

  it("blocks a between with a missing bound", () => {
    const draft = { ...blankConditionDraft(), field: "propensity_score", operator: "between" as const, low: "10" };
    const result = draftToCondition(draft);
    expect("error" in result && result.error).toBe("Both bounds are required.");
  });

  it("blocks a between with low > high, mirroring the API's save-time rejection", () => {
    const draft = { ...blankConditionDraft(), field: "propensity_score", operator: "between" as const, low: "80", high: "20" };
    const result = draftToCondition(draft);
    expect("error" in result && result.error).toBe("The low bound must not exceed the high bound.");
  });

  it("accepts an inclusive between with low <= high", () => {
    const draft = { ...blankConditionDraft(), field: "propensity_score", operator: "between" as const, low: "20", high: "20" };
    expect(draftToCondition(draft)).toEqual({ condition: { field: "propensity_score", operator: "between", value: ["20", "20"] } });
  });

  it("validates date bounds lexically rather than numerically", () => {
    const draft = { ...blankConditionDraft(), field: "last_purchase_date", operator: "between" as const, low: "2026-06-01", high: "2026-01-01" };
    const result = draftToCondition(draft);
    expect("error" in result && result.error).toBe("The low bound must not exceed the high bound.");
  });

  it("requires a non-empty value list for `in`", () => {
    const draft = { ...blankConditionDraft(), field: "branch_code", operator: "in" as const, values: [] };
    expect(draftToCondition(draft)).toEqual({ error: "Add at least one value." });
    const withValues = { ...draft, values: ["A1", "A2"] };
    expect(draftToCondition(withValues)).toEqual({ condition: { field: "branch_code", operator: "in", value: ["A1", "A2"] } });
  });

  it("rejects a non-numeric value for a numeric field", () => {
    const draft = { ...blankConditionDraft(), field: "propensity_rank", operator: "=" as const, value: "abc" };
    expect(draftToCondition(draft)).toEqual({ error: "Enter a number." });
  });
});

describe("admin assignment: conditionToDraft round-trip", () => {
  it("round-trips every operator shape back into an equivalent condition", () => {
    const cases: RuleCondition[] = [
      { field: "name", operator: "=", value: "Acme" },
      { field: "propensity_score", operator: "between", value: ["10", "20"] },
      { field: "branch_code", operator: "in", value: ["A1", "A2"] },
      { field: "last_purchase_date", operator: "is-null", value: null },
    ];
    for (const condition of cases) {
      const draft = conditionToDraft(condition);
      const result = draftToCondition(draft);
      expect("condition" in result && result.condition).toEqual(condition);
    }
  });
});

describe("admin assignment: describeCondition", () => {
  it("renders a human-readable summary for each condition shape", () => {
    expect(describeCondition({ field: "propensity_tier", operator: "=", value: "A" })).toBe("Propensity tier equals A");
    expect(describeCondition({ field: "propensity_score", operator: "between", value: ["10", "20"] })).toBe("Propensity score between 10 and 20");
    expect(describeCondition({ field: "branch_code", operator: "in", value: ["A1", "A2"] })).toBe("Branch code is one of A1, A2");
    expect(describeCondition({ field: "recent", operator: "=", value: true })).toBe("Recent is true");
    expect(describeCondition({ field: "last_purchase_date", operator: "is-null", value: null })).toBe("Last purchase date is empty");
  });
});

describe("admin assignment: conflict message classification", () => {
  it("distinguishes a duplicate-name 409 from a stale-version 409 by the backend's own detail text", () => {
    expect(isDuplicateNameConflict("Rule already exists.")).toBe(true);
    expect(isDuplicateNameConflict("Assignment configuration is stale.")).toBe(false);
    expect(isStaleVersionConflict("Assignment configuration is stale.")).toBe(true);
    expect(isStaleVersionConflict("Rule already exists.")).toBe(false);
  });
});

describe("admin assignment: initialConditionDrafts", () => {
  const rule = { id: "rule-1", name: "Everyone", conditions: [], memberIds: ["sales-river"], active: true, order: 1 };

  it("starts a new rule with one blank condition", () => {
    expect(initialConditionDrafts()).toHaveLength(1);
  });

  it("starts editing a saved zero-condition rule with no conditions (no injected blank one)", () => {
    expect(initialConditionDrafts(rule)).toEqual([]);
  });

  it("starts editing a rule with exactly its saved conditions", () => {
    const drafts = initialConditionDrafts({ ...rule, conditions: [{ field: "propensity_tier", operator: "=", value: "A" }] });
    expect(drafts.map(draftToCondition)).toEqual([{ condition: { field: "propensity_tier", operator: "=", value: "A" } }]);
  });
});

describe("admin assignment: overlap detection (#71)", () => {
  const c = (field: string, operator: RuleCondition["operator"], value: RuleCondition["value"] = null): RuleCondition => ({ field, operator, value });

  it("treats a rule with no conditions as overlapping everything", () => {
    expect(rulesMayOverlap([], [c("propensity_tier", "=", "A")])).toBe(true);
    expect(rulesMayOverlap([c("propensity_tier", "=", "A")], [])).toBe(true);
  });

  it("does not overlap when the same text field requires different values", () => {
    expect(rulesMayOverlap([c("propensity_tier", "=", "A")], [c("propensity_tier", "=", "B")])).toBe(false);
    expect(rulesMayOverlap([c("propensity_tier", "in", ["A", "B"])], [c("propensity_tier", "in", ["C"])])).toBe(false);
    expect(rulesMayOverlap([c("propensity_tier", "in", ["A", "B"])], [c("propensity_tier", "=", "B")])).toBe(true);
  });

  it("is case-sensitive for = (like the backend) but case-folded for contains", () => {
    expect(conditionsDisjoint(c("name", "=", "Acme"), c("name", "=", "acme"))).toBe(true);
    expect(conditionsDisjoint(c("name", "=", "Big Acme"), c("name", "contains", "acme"))).toBe(false);
    expect(conditionsDisjoint(c("name", "in", ["Beta", "Gamma"]), c("name", "contains", "acme"))).toBe(true);
  });

  it("handles != against = and against another != / contains", () => {
    expect(conditionsDisjoint(c("branch_code", "=", "X1"), c("branch_code", "!=", "X1"))).toBe(true);
    expect(conditionsDisjoint(c("branch_code", "=", "X2"), c("branch_code", "!=", "X1"))).toBe(false);
    expect(conditionsDisjoint(c("branch_code", "!=", "X1"), c("branch_code", "!=", "X2"))).toBe(false);
    expect(conditionsDisjoint(c("branch_code", "contains", "a"), c("branch_code", "contains", "b"))).toBe(false);
    expect(conditionsDisjoint(c("propensity_score", "=", "5"), c("propensity_score", "!=", "5.0"))).toBe(true);
    expect(conditionsDisjoint(c("propensity_score", ">", "5"), c("propensity_score", "!=", "5"))).toBe(false);
  });

  it("compares numeric ranges with inclusive/exclusive bounds", () => {
    expect(conditionsDisjoint(c("propensity_score", "<", "50"), c("propensity_score", ">=", "50"))).toBe(true);
    expect(conditionsDisjoint(c("propensity_score", "<=", "50"), c("propensity_score", ">=", "50"))).toBe(false);
    expect(conditionsDisjoint(c("propensity_score", "between", ["0", "10"]), c("propensity_score", "between", ["10", "20"]))).toBe(false);
    expect(conditionsDisjoint(c("propensity_score", "between", ["0", "9"]), c("propensity_score", ">", "9"))).toBe(true);
    expect(conditionsDisjoint(c("revenue_amount_2025", "=", "100"), c("revenue_amount_2025", "between", ["50", "150"]))).toBe(false);
  });

  it("compares date ranges", () => {
    expect(conditionsDisjoint(c("last_purchase_date", "<", "2025-01-01"), c("last_purchase_date", ">=", "2025-01-01"))).toBe(true);
    expect(conditionsDisjoint(c("last_purchase_date", "between", ["2024-01-01", "2024-12-31"]), c("last_purchase_date", ">", "2024-06-30"))).toBe(false);
  });

  it("handles booleans, where != true means = false", () => {
    expect(conditionsDisjoint(c("recent", "=", true), c("recent", "=", false))).toBe(true);
    expect(conditionsDisjoint(c("recent", "!=", true), c("recent", "=", false))).toBe(false);
    expect(conditionsDisjoint(c("recent", "!=", false), c("recent", "=", true))).toBe(false);
  });

  it("treats is-null as disjoint from every value operator, since only is-null matches null", () => {
    expect(conditionsDisjoint(c("rsm_name", "is-null"), c("rsm_name", "!=", "Kim"))).toBe(true);
    expect(conditionsDisjoint(c("rsm_name", "is-null"), c("rsm_name", "is-not-null"))).toBe(true);
    expect(conditionsDisjoint(c("rsm_name", "is-null"), c("rsm_name", "is-null"))).toBe(false);
    expect(conditionsDisjoint(c("rsm_name", "is-not-null"), c("rsm_name", "=", "Kim"))).toBe(false);
  });

  it("needs only one disjoint same-field pair; conditions on different fields can always overlap", () => {
    const a = [c("propensity_tier", "=", "A"), c("recent", "=", true)];
    expect(rulesMayOverlap(a, [c("branch_code", "=", "X1")])).toBe(true);
    expect(rulesMayOverlap(a, [c("branch_code", "=", "X1"), c("recent", "=", false)])).toBe(false);
  });
});
