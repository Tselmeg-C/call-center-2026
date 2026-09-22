import { describe, expect, it } from "vitest";
import {
  CONDITION_FIELDS,
  blankConditionDraft,
  conditionImplies,
  conditionToDraft,
  conditionsDisjoint,
  describeCondition,
  draftToCondition,
  fieldKind,
  initialConditionDrafts,
  isDuplicateNameConflict,
  isStaleVersionConflict,
  ruleContradicts,
  ruleCovers,
  rulesMayOverlap,
  sortByPriority,
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

describe("admin assignment: ruleCovers (#102)", () => {
  const c = (field: string, operator: RuleCondition["operator"], value: RuleCondition["value"] = null): RuleCondition => ({ field, operator, value });

  it("treats a zero-condition rule as a catch-all that covers everything, including another catch-all", () => {
    expect(ruleCovers([], [c("propensity_tier", "=", "A")])).toBe(true);
    expect(ruleCovers([], [])).toBe(true);
  });

  it("covers catch-all and text `in`/`=` combinations, but not the reverse", () => {
    expect(ruleCovers([c("propensity_tier", "in", ["A", "B"])], [c("propensity_tier", "=", "A")])).toBe(true);
    expect(ruleCovers([c("propensity_tier", "in", ["A", "B"])], [c("propensity_tier", "in", ["B", "A"])])).toBe(true);
    expect(ruleCovers([c("propensity_tier", "=", "A")], [c("propensity_tier", "in", ["A", "B"])])).toBe(false);
  });

  it("is case-sensitive for text `=`", () => {
    expect(ruleCovers([c("name", "=", "Acme")], [c("name", "=", "acme")])).toBe(false);
  });

  it("covers/doesn't cover via `!=`", () => {
    expect(ruleCovers([c("branch_code", "!=", "X1")], [c("branch_code", "=", "X2")])).toBe(true);
    expect(ruleCovers([c("branch_code", "!=", "X1")], [c("branch_code", "!=", "X1")])).toBe(true);
    expect(ruleCovers([c("branch_code", "!=", "X1")], [c("branch_code", "in", ["X1", "X2"])])).toBe(false);
    expect(ruleCovers([c("branch_code", "!=", "X1")], [c("branch_code", "!=", "X2")])).toBe(false);
  });

  it("is case-insensitive for `contains`", () => {
    expect(ruleCovers([c("name", "contains", "acme")], [c("name", "=", "Big ACME Ltd")])).toBe(true);
    expect(ruleCovers([c("name", "contains", "acme")], [c("name", "in", ["Acme", "Acme Corp"])])).toBe(true);
    expect(ruleCovers([c("name", "contains", "acme")], [c("name", "contains", "Big Acme")])).toBe(true);
    expect(ruleCovers([c("name", "contains", "acme")], [c("name", "contains", "acm")])).toBe(false);
    expect(ruleCovers([c("name", "contains", "acme")], [c("name", "in", ["Acme", "Beta"])])).toBe(false);
  });

  it("respects inclusive/exclusive numeric range bounds", () => {
    expect(ruleCovers([c("propensity_score", ">=", "50")], [c("propensity_score", "between", ["60", "80"])])).toBe(true);
    expect(ruleCovers([c("propensity_score", ">=", "50")], [c("propensity_score", "=", "50")])).toBe(true);
    expect(ruleCovers([c("propensity_score", ">", "50")], [c("propensity_score", "between", ["50", "80"])])).toBe(false);
    expect(ruleCovers([c("propensity_score", "<", "50")], [c("propensity_score", "=", "10")])).toBe(true);
    expect(ruleCovers([c("propensity_score", "between", ["0", "100"])], [c("propensity_score", "between", ["0", "100"])])).toBe(true);
  });

  it("compares numbers as numbers, and `!=` against a value/range excluding the point", () => {
    expect(ruleCovers([c("propensity_score", "=", "5")], [c("propensity_score", "=", "5.0")])).toBe(true);
    expect(ruleCovers([c("propensity_score", "!=", "5")], [c("propensity_score", ">", "5")])).toBe(true);
    expect(ruleCovers([c("propensity_score", "!=", "5")], [c("propensity_score", "=", "6")])).toBe(true);
    expect(ruleCovers([c("propensity_score", "!=", "5")], [c("propensity_score", ">=", "5")])).toBe(false);
  });

  it("compares date ranges", () => {
    expect(
      ruleCovers([c("last_purchase_date", "<", "2025-01-01")], [c("last_purchase_date", "between", ["2024-01-01", "2024-12-31"])]),
    ).toBe(true);
    expect(ruleCovers([c("last_purchase_date", "<", "2025-01-01")], [c("last_purchase_date", "<=", "2025-01-01")])).toBe(false);
  });

  it("compares booleans", () => {
    expect(ruleCovers([c("recent", "!=", true)], [c("recent", "=", false)])).toBe(true);
    expect(ruleCovers([c("recent", "=", true)], [c("recent", "=", false)])).toBe(false);
  });

  it("handles null/not-null semantics", () => {
    expect(ruleCovers([c("rsm_name", "is-not-null")], [c("rsm_name", "=", "Kim")])).toBe(true);
    expect(ruleCovers([c("rsm_name", "is-not-null")], [c("rsm_name", "!=", "Kim")])).toBe(true);
    expect(ruleCovers([c("rsm_name", "is-not-null")], [c("rsm_name", "is-null")])).toBe(false);
    expect(ruleCovers([c("rsm_name", "is-null")], [c("rsm_name", "is-null")])).toBe(true);
    expect(ruleCovers([c("rsm_name", "is-null")], [c("rsm_name", "=", "Kim")])).toBe(false);
    expect(ruleCovers([c("rsm_name", "!=", "Kim")], [c("rsm_name", "is-not-null")])).toBe(false);
  });

  it("never combines multiple conditions on either side", () => {
    expect(ruleCovers([c("propensity_tier", "=", "A")], [c("propensity_tier", "=", "A"), c("recent", "=", true)])).toBe(true);
    expect(ruleCovers([c("propensity_tier", "=", "A"), c("recent", "=", true)], [c("propensity_tier", "=", "A")])).toBe(false);
    expect(ruleCovers([c("branch_code", "=", "X1")], [c("propensity_tier", "=", "A")])).toBe(false);
  });

  it("stays conservative about misses that would need combining conditions", () => {
    expect(
      ruleCovers([c("propensity_score", "between", ["0", "10"])], [c("propensity_score", ">=", "2"), c("propensity_score", "<=", "8")]),
    ).toBe(false);
    expect(ruleCovers([c("propensity_tier", "in", ["A", "B"])], [c("propensity_tier", "contains", "A")])).toBe(false);
  });
});

describe("admin assignment: ruleContradicts (#102)", () => {
  const c = (field: string, operator: RuleCondition["operator"], value: RuleCondition["value"] = null): RuleCondition => ({ field, operator, value });

  it("flags a disjoint same-field pair", () => {
    expect(ruleContradicts([c("propensity_score", "<", "1"), c("propensity_score", ">", "5")])).toBe(true);
    expect(ruleContradicts([c("propensity_tier", "=", "A"), c("propensity_tier", "=", "B")])).toBe(true);
    expect(ruleContradicts([c("rsm_name", "is-null"), c("rsm_name", "=", "Kim")])).toBe(true);
    expect(ruleContradicts([c("recent", "=", true), c("recent", "!=", true)])).toBe(true);
    expect(ruleContradicts([c("last_purchase_date", "<", "2024-01-01"), c("last_purchase_date", ">", "2024-06-30")])).toBe(true);
  });

  it("does not flag a satisfiable pair, cross-field pairs, an empty list, or a conservative three-way miss", () => {
    expect(ruleContradicts([c("propensity_score", "<=", "5"), c("propensity_score", ">=", "5")])).toBe(false);
    expect(ruleContradicts([c("propensity_tier", "in", ["A", "B"]), c("propensity_tier", "!=", "A")])).toBe(false);
    expect(ruleContradicts([c("propensity_tier", "=", "A"), c("recent", "=", false)])).toBe(false);
    expect(ruleContradicts([])).toBe(false);
    expect(
      ruleContradicts([c("propensity_tier", "in", ["A", "B"]), c("propensity_tier", "!=", "A"), c("propensity_tier", "!=", "B")]),
    ).toBe(false);
  });
});

describe("admin assignment: precision gap fix from #71 QA (#102)", () => {
  const c = (field: string, operator: RuleCondition["operator"], value: RuleCondition["value"] = null): RuleCondition => ({ field, operator, value });

  it("never proves disjointness/implication/contradiction from a >15-significant-digit numeric value", () => {
    expect(conditionsDisjoint(c("propensity_score", "=", "0.1"), c("propensity_score", "!=", "0.10000000000000001"))).toBe(false);
    expect(ruleContradicts([c("propensity_score", "=", "0.1"), c("propensity_score", "!=", "0.10000000000000001")])).toBe(false);
    expect(conditionsDisjoint(c("revenue_amount_2025", "=", "9007199254740993"), c("revenue_amount_2025", "!=", "9007199254740992"))).toBe(false);
    expect(conditionsDisjoint(c("propensity_score", "<", "0.10000000000000001"), c("propensity_score", ">=", "0.1"))).toBe(false);
  });

  it("never proves disjointness/covering from a non-ASCII `contains` comparison", () => {
    expect(conditionsDisjoint(c("name", "=", "Straße"), c("name", "contains", "SS"))).toBe(false);
    expect(ruleCovers([c("name", "contains", "SS")], [c("name", "=", "Straße")])).toBe(false);
  });

  it("still resolves conditionImplies directly for a safe numeric pair", () => {
    expect(conditionImplies(c("propensity_score", "=", "5"), c("propensity_score", ">=", "5"))).toBe(true);
  });
});

describe("admin assignment: sortByPriority", () => {
  it("sorts by order, then by id for rules sharing an order (like ordered_rules())", () => {
    const rules = [
      { id: "rule-b", order: 2 },
      { id: "rule-z", order: 1 },
      { id: "rule-a", order: 2 },
    ];
    expect(sortByPriority(rules).map((r) => r.id)).toEqual(["rule-z", "rule-a", "rule-b"]);
    expect(rules.map((r) => r.id)).toEqual(["rule-b", "rule-z", "rule-a"]); // input untouched
  });
});
