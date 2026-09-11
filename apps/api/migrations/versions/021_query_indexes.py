"""Indexes for bounded customer, history, workload, and audit queries."""
from alembic import op

revision = "021_query_indexes"
down_revision = "020_assignment_identity_fks"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        for name, table, columns in (
            ("ix_customers_owner_status", "customers", ["owner_id", "status"]),
            ("ix_customer_phones_bcn", "customer_phones", ["bcn"]),
            ("ix_activities_bcn_created", "activities", ["bcn", "created_at"]),
            ("ix_follow_ups_bcn_status_due", "follow_ups", ["bcn", "status", "due"]),
            ("ix_audit_events_created", "audit_events", ["created_at", "id"]),
        ):
            op.create_index(name, table, columns)

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
