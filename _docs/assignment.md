# Assignment rules (mock)

The mock service currently exposes Admin-only manual assignment with active Sales eligibility, Unassigned support, no-change results, and immutable assignment history. Bulk ordered rules and workload balancing are reserved for the assignment-run implementation; imports and user changes never trigger assignment automatically.

Rules evaluate imported fields (`bcn`, MBCN, customer name, propensity score/tier/rank, imported booleans, dates, revenue/FEM amounts, sales-organization fields, and Payment_Terms). Text uses trimmed case-folded `=`, `!=`, `contains`, and `in`; numeric values support comparison and inclusive `between`; nulls use `is-null`/`is-not-null`. Empty or inverted ranges and empty eligible sets are rejected.
