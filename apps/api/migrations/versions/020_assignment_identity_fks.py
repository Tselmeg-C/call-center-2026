"""Enforce identity links for assignment configuration and events."""
from alembic import op

revision = "020_assignment_identity_fks"
down_revision = "019_assignment_run_fingerprint"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        for table, column, name in (
            ("assignment_rules", "owner_id", "fk_assignment_rules_owner"),
            ("assignment_history", "actor_id", "fk_assignment_history_actor"),
            ("audit_events", "actor_id", "fk_audit_events_actor"),
        ):
            op.execute(f"ALTER TABLE {table} ADD CONSTRAINT {name} FOREIGN KEY ({column}) REFERENCES users(id) NOT VALID")

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
