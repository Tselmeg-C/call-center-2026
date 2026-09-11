"""Persist import payload fingerprints with durable jobs."""
from alembic import op
import sqlalchemy as sa

revision = "028_import_fingerprint"
down_revision = "027_retry_actor_fks"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.add_column("import_jobs", sa.Column("fingerprint", sa.String(64), nullable=True))

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
