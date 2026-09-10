# Excel import (mock)

The Admin upload accepts one `.xlsx` file up to 10 MiB. Parsing is simulated in the mock; production parsing belongs to the upload backend. The first worksheet is used, extra sheets are ignored, and required headers are trimmed and matched exactly once regardless of order. A mixed synthetic workbook produces three processed rows: one created, one updated, and one error row (numeric BCN rejected). Fully blank rows are ignored; invalid rows do not mutate customers.

Imported fields are source attributes: `bcn` (required text, max 128), `customer_name` (required text, max 255), phone (nullable text, max 64), booleans `previously_contacted` and `recent`, nonnegative integer `propensity_rank`, decimal `propensity_score`, revenue/FEM amounts, dates, vendor/category names and amounts. Blank nullable cells clear their imported value. Ownership, lifecycle, interactions, notes, follow-ups, and non-primary phones are preserved.
