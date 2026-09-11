"""Persist extensible vendor and category import pairs."""
from alembic import op
import sqlalchemy as sa

revision = "016_customer_collections"
down_revision = "015_typed_customer_source"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.create_table("customer_collections",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("bcn", sa.String(128), sa.ForeignKey("customers.bcn", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("slot", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("revenue", sa.Numeric(18, 6), nullable=True),
            sa.UniqueConstraint("bcn", "kind", "slot", name="uq_customer_collection_slot"),
        )

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
