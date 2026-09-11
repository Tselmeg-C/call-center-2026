"""Store defined workbook attributes with their native types."""
from alembic import op
import sqlalchemy as sa

revision = "015_typed_customer_source"
down_revision = "014_assignment_owner_fks"
branch_labels = None
depends_on = None

_columns = (
    ("mbcn", sa.String(128)),
    ("previously_contacted", sa.Boolean()),
    ("propensity_score", sa.Numeric(18, 6)),
    ("propensity_tier", sa.String(64)),
    ("propensity_rank", sa.Integer()),
    ("inside_lead", sa.String(255)), ("field_rep", sa.String(255)),
    ("sc_naming", sa.String(255)), ("inside_rep", sa.String(255)),
    ("branch_code", sa.String(128)), ("rsm_name", sa.String(255)),
    ("originating_bu", sa.String(255)), ("last_purchase_date", sa.Date()),
    ("recent", sa.Boolean()),
    ("revenue_amount_2024", sa.Numeric(18, 6)), ("revenue_amount_2025", sa.Numeric(18, 6)),
    ("revenue_amount_2026", sa.Numeric(18, 6)), ("fem_amount_2024", sa.Numeric(18, 6)),
    ("fem_amount_2025", sa.Numeric(18, 6)), ("fem_amount_2026", sa.Numeric(18, 6)),
    ("payment_terms", sa.String(128)),
)

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        for name, column_type in _columns:
            op.add_column("customers", sa.Column(name, column_type, nullable=True))

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
