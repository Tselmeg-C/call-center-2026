"""Keep activity and follow-up records linked to a customer."""
from alembic import op
import sqlalchemy as sa

revision = "018_activity_customer_fks"
down_revision = "017_customer_owner_fk"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        for table in ("activities", "follow_ups"):
            op.alter_column(table, "bcn", type_=sa.String(128), existing_type=sa.String(64))
            op.create_foreign_key(f"fk_{table}_customer", table, "customers", ["bcn"], ["bcn"], ondelete="CASCADE")

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
