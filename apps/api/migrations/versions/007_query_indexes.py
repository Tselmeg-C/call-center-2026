from alembic import op

revision = "007_query_indexes"
down_revision = "006_rule_owner"
branch_labels = None
depends_on = None

def upgrade():
    op.create_index("ix_customers_status_owner", "customers", ["status", "owner_id"])
    op.create_index("ix_activities_bcn_created", "activities", ["bcn", "created_at"])
    op.create_index("ix_audit_events_created", "audit_events", ["created_at"])

def downgrade():
    op.drop_index("ix_audit_events_created", table_name="audit_events")
    op.drop_index("ix_activities_bcn_created", table_name="activities")
    op.drop_index("ix_customers_status_owner", table_name="customers")
