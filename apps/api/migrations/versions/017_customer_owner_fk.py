"""Prevent dangling current customer owners."""
from alembic import op

revision = "017_customer_owner_fk"
down_revision = "016_customer_collections"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.create_foreign_key("fk_customers_owner", "customers", "users", ["owner_id"], ["id"], ondelete="SET NULL")

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
