"""Keep assignment history attached to an existing customer."""
from alembic import op

revision = "026_assignment_customer_fk"
down_revision = "025_followup_interaction_link"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE assignment_history ADD CONSTRAINT fk_assignment_history_customer FOREIGN KEY (bcn) REFERENCES customers(bcn) ON DELETE RESTRICT NOT VALID")

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
