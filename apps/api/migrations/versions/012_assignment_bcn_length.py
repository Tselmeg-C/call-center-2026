"""Keep assignment history BCN width aligned with customer identity."""
from alembic import op
import sqlalchemy as sa

revision = "012_assignment_bcn_length"
down_revision = "011_import_actor_submission"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.alter_column("assignment_history", "bcn", existing_type=sa.String(64), type_=sa.String(128), existing_nullable=False)


def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
