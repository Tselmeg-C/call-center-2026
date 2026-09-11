"""Scope import retry ownership to actor and submission."""
from alembic import op
import sqlalchemy as sa

revision = "011_import_actor_submission"
down_revision = "010_customer_import_constraints"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_submission_id_key")
        op.create_unique_constraint("uq_import_actor_submission", "import_jobs", ["actor_id", "submission_id"])


def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
