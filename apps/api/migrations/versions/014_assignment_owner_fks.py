"""Reject dangling owner references in assignment history."""
from alembic import op

revision = "014_assignment_owner_fks"
down_revision = "013_assignment_actor_submission"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.create_foreign_key("fk_assignment_history_old_owner", "assignment_history", "users", ["old_owner_id"], ["id"])
        op.create_foreign_key("fk_assignment_history_new_owner", "assignment_history", "users", ["new_owner_id"], ["id"])


def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
