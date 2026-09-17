"""Condition matching and eligible-member selection for assignment rules.

Pure functions shared by the memory-mode engine (main.py) and the PostgreSQL
engine (db_assignment.py) so the two storage adapters can never drift apart on
what a condition means or how a candidate is picked.
"""
from datetime import date
from decimal import Decimal, InvalidOperation
import logging
import re

logger = logging.getLogger("call-center.assignment")

TEXT_FIELDS = {"bcn", "mbcn", "name", "propensity_tier", "inside_lead", "field_rep", "sc_naming", "inside_rep", "branch_code", "rsm_name", "originating_bu", "payment_terms"}
NUMERIC_FIELDS = {"propensity_score", "propensity_rank", "revenue_amount_2024", "revenue_amount_2025", "revenue_amount_2026", "fem_amount_2024", "fem_amount_2025", "fem_amount_2026"}
BOOLEAN_FIELDS = {"previously_contacted", "recent"}
DATE_FIELDS = {"last_purchase_date"}
CONDITION_FIELDS = TEXT_FIELDS | NUMERIC_FIELDS | BOOLEAN_FIELDS | DATE_FIELDS

TEXT_OPERATORS = {"=", "!=", "contains", "in", "is-null", "is-not-null"}
ORDERED_OPERATORS = {"=", "!=", "<", "<=", ">", ">=", "between", "is-null", "is-not-null"}
BOOLEAN_OPERATORS = {"=", "!=", "is-null", "is-not-null"}
NULL_OPERATORS = {"is-null", "is-not-null"}


MAX_TEXT_LENGTH = 255
MAX_IN_ITEMS = 500
MAX_NUMERIC_LENGTH = 64
DATE_ONLY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


class ConditionError(ValueError):
    """A condition is malformed or uses an operator not allowed for its field type."""


def field_kind(field: str) -> str:
    if field in TEXT_FIELDS: return "text"
    if field in NUMERIC_FIELDS: return "numeric"
    if field in BOOLEAN_FIELDS: return "boolean"
    if field in DATE_FIELDS: return "date"
    raise ConditionError(f"Unknown condition field: {field!r}")


def allowed_operators(kind: str) -> set[str]:
    return {"text": TEXT_OPERATORS, "numeric": ORDERED_OPERATORS, "date": ORDERED_OPERATORS, "boolean": BOOLEAN_OPERATORS}[kind]


def normalize_operator(raw: object) -> str:
    return str(raw).strip().casefold()


def _coerce_scalar(kind: str, value: object):
    if kind == "numeric":
        try:
            return Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            raise ConditionError("Numeric value required") from None
    if kind == "date":
        if isinstance(value, date):
            return value
        try:
            return date.fromisoformat(str(value)[:10])
        except (ValueError, TypeError):
            raise ConditionError("Date value required (YYYY-MM-DD)") from None
    raise ConditionError(f"Unsupported field kind: {kind}")


def _store_scalar(kind: str, value):
    if kind == "numeric": return str(value)
    if kind == "date": return value.isoformat()
    return value


def _text_ok(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) <= MAX_TEXT_LENGTH


def _check_scalar(kind: str, value: object) -> None:
    """Save-time input checks only (#64); evaluation still goes through _coerce_scalar unchanged."""
    if kind == "numeric":
        if isinstance(value, bool) or len(str(value)) > MAX_NUMERIC_LENGTH: raise ConditionError("Numeric value required")
        if not _coerce_scalar(kind, value).is_finite(): raise ConditionError("Numeric value must be finite")
    elif kind == "date" and not (isinstance(value, str) and DATE_ONLY.fullmatch(value)):
        raise ConditionError("Date value required (YYYY-MM-DD)")


def validate_condition(field: object, operator: object, value: object) -> dict:
    """Validate one (field, operator, value) triple at save time; returns the JSON-storable condition dict, or raises ConditionError (caller maps this to a 422)."""
    if not isinstance(field, str) or field not in CONDITION_FIELDS:
        raise ConditionError(f"Unknown condition field: {field!r}")
    kind = field_kind(field)
    op = normalize_operator(operator)
    if op not in allowed_operators(kind):
        raise ConditionError(f"Operator {operator!r} is not allowed for field {field!r}")
    if op in NULL_OPERATORS:
        return {"field": field, "operator": op, "value": None}
    if op == "in":
        if not isinstance(value, list) or not value or len(value) > MAX_IN_ITEMS or not all(_text_ok(item) for item in value):
            raise ConditionError(f"`in` requires 1-{MAX_IN_ITEMS} non-empty strings of at most {MAX_TEXT_LENGTH} characters")
        return {"field": field, "operator": op, "value": list(value)}
    if op == "between":
        if not isinstance(value, (list, tuple)) or len(value) != 2 or value[0] is None or value[1] is None:
            raise ConditionError("`between` requires both a low and a high bound")
        _check_scalar(kind, value[0]); _check_scalar(kind, value[1])
        low, high = _coerce_scalar(kind, value[0]), _coerce_scalar(kind, value[1])
        if low > high:
            raise ConditionError("`between` low bound must not exceed the high bound")
        return {"field": field, "operator": op, "value": [_store_scalar(kind, low), _store_scalar(kind, high)]}
    if kind == "boolean":
        if not isinstance(value, bool):
            raise ConditionError("Boolean field requires a true/false value")
        return {"field": field, "operator": op, "value": value}
    if kind == "text":
        if not _text_ok(value):
            raise ConditionError(f"Text field requires a non-empty string of at most {MAX_TEXT_LENGTH} characters")
        return {"field": field, "operator": op, "value": value}
    _check_scalar(kind, value)
    return {"field": field, "operator": op, "value": _store_scalar(kind, _coerce_scalar(kind, value))}


def validate_conditions(raw_conditions: list) -> list[dict]:
    return [validate_condition(item.get("field") if isinstance(item, dict) else getattr(item, "field", None), item.get("operator") if isinstance(item, dict) else getattr(item, "operator", None), item.get("value") if isinstance(item, dict) else getattr(item, "value", None)) for item in raw_conditions]


def evaluate_condition(value: object, condition: dict) -> bool:
    field = condition["field"]; operator = condition["operator"]; kind = field_kind(field)
    if operator == "is-null": return value is None
    if operator == "is-not-null": return value is not None
    if value is None: return False  # != (and every other operator) never matches null; only is-null does.
    if kind == "text":
        text_value = str(value); target = condition["value"]
        if operator == "=": return text_value == target
        if operator == "!=": return text_value != target
        if operator == "contains": return target.casefold() in text_value.casefold()
        if operator == "in": return text_value in target
        raise ConditionError(f"Unsupported operator {operator!r} for text field")
    if kind == "boolean":
        current = bool(value); target = condition["value"]
        if operator == "=": return current == target
        if operator == "!=": return current != target
        raise ConditionError(f"Unsupported operator {operator!r} for boolean field")
    current = _coerce_scalar(kind, value)
    if operator == "between":
        low, high = _coerce_scalar(kind, condition["value"][0]), _coerce_scalar(kind, condition["value"][1])
        return low <= current <= high
    target = _coerce_scalar(kind, condition["value"])
    if operator == "=": return current == target
    if operator == "!=": return current != target
    if operator == "<": return current < target
    if operator == "<=": return current <= target
    if operator == ">": return current > target
    if operator == ">=": return current >= target
    raise ConditionError(f"Unsupported operator {operator!r} for {kind} field")


def rule_matches(get_field, conditions: list[dict]) -> bool:
    """A rule matches only if every one of its (AND-combined) conditions matches; no conditions matches unconditionally."""
    return all(evaluate_condition(get_field(condition["field"]), condition) for condition in conditions)


def pick_candidate(members: list[str], counts: dict[str, int]) -> str:
    """Fewest currently open-owned customers wins, ties broken by ascending user id.

    Pure: does not mutate `counts`. Callers must bump the chosen member's count themselves once an
    assignment is actually made (see `record_pick`) -- a pick that turns out to be a no-op (the
    customer already belongs to the chosen member) must not inflate their tracked workload."""
    return min(members, key=lambda member_id: (counts.get(member_id, 0), member_id))


def record_pick(counts: dict[str, int], member_id: str) -> None:
    """Bump a member's in-run open-owned count immediately after an actual (non-no-op) assignment, so the next pick in the same run sees it."""
    counts[member_id] = counts.get(member_id, 0) + 1


def resolve_owner(get_field, rules: list[dict], fallback_ids, active_sales_ids, counts: dict[str, int]) -> tuple[str | None, str | None]:
    """Walk rules in position order; first match with a non-empty eligible (active-Sales) member set wins.
    A match with zero eligible members is logged and skipped in favor of the next rule. No match (or an
    empty eligible fallback) falls back to `fallback_ids`; if that is also empty, returns (None, reason).

    Does not mutate `counts` -- callers call `record_pick` once they know the pick is a real (non-no-op)
    assignment, so a customer that already belongs to the picked member never inflates their workload."""
    active = set(active_sales_ids)
    for rule in rules:
        if not rule.get("active", True): continue
        if not rule_matches(get_field, rule.get("conditions", [])): continue
        eligible = sorted({member for member in rule.get("member_ids", []) if member in active})
        if not eligible:
            logger.warning("Assignment rule %r matched but has no eligible active-Sales members; trying the next rule", rule.get("name") or rule.get("id"))
            continue
        return pick_candidate(eligible, counts), None
    eligible = sorted({member for member in fallback_ids if member in active})
    if not eligible:
        logger.warning("No eligible salesperson: no rule matched and the fallback list is empty")
        return None, "No eligible salesperson"
    return pick_candidate(eligible, counts), None
