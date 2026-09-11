"""Prevent dangling current customer owners."""
from alembic import op

revision = "017_customer_owner_fk"
down_revision = "016_customer_collections"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE customers ADD CONSTRAINT fk_customers_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID")

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
