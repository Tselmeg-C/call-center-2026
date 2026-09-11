"""Persist the one-to-one completed follow-up interaction link."""
from alembic import op
import sqlalchemy as sa

revision = "025_followup_interaction_link"
down_revision = "024_collection_constraints"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.add_column("follow_ups", sa.Column("interaction_id", sa.String(120), nullable=True))
        op.create_unique_constraint("uq_followup_interaction", "follow_ups", ["interaction_id"])
        op.create_foreign_key("fk_followup_interaction", "follow_ups", "activities", ["interaction_id"], ["id"], ondelete="RESTRICT")

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
