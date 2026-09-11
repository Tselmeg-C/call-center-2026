"""Bind assignment retries to their original request scope."""
from alembic import op
import sqlalchemy as sa

revision = "019_assignment_run_fingerprint"
down_revision = "018_activity_customer_fks"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.add_column("assignment_runs", sa.Column("fingerprint", sa.String(64), nullable=True))

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
