"""Scope assignment-run retries to actor and submission."""
from alembic import op
import sqlalchemy as sa

revision = "013_assignment_actor_submission"
down_revision = "012_assignment_bcn_length"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint("assignment_runs_pkey", "assignment_runs", type_="primary")
        op.add_column("assignment_runs", sa.Column("actor_id", sa.String(120), nullable=True))
        op.execute("UPDATE assignment_runs SET actor_id = 'legacy'")
        op.alter_column("assignment_runs", "actor_id", nullable=False)
        op.create_primary_key("assignment_runs_pkey", "assignment_runs", ["actor_id", "submission_id"])


def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
