"""Replace per-rule ownership with condition-based matching."""
from alembic import op
import sqlalchemy as sa

revision = "029_assignment_conditions"
down_revision = "028_import_fingerprint"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE assignment_rules DROP CONSTRAINT IF EXISTS fk_assignment_rules_owner")
        op.drop_column("assignment_rules", "owner_id")
        op.add_column("assignment_rules", sa.Column("conditions", sa.JSON, nullable=False, server_default="[]"))

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
