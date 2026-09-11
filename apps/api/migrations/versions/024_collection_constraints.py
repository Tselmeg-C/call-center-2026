"""Reject malformed extensible source collections."""
from alembic import op

revision = "024_collection_constraints"
down_revision = "023_append_only_audit"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.create_check_constraint("customer_collection_kind_valid", "customer_collections", "kind IN ('vendor', 'category')")
        op.create_check_constraint("customer_collection_slot_valid", "customer_collections", "slot > 0")
        op.create_check_constraint("customer_collection_name_present", "customer_collections", "length(btrim(name)) > 0")

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
