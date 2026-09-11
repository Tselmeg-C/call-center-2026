"""Tie durable retry records to known actors."""
from alembic import op

revision = "027_retry_actor_fks"
down_revision = "026_assignment_customer_fk"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE import_jobs ADD CONSTRAINT fk_import_jobs_actor FOREIGN KEY (actor_id) REFERENCES users(id) NOT VALID")
        op.execute("ALTER TABLE assignment_runs ADD CONSTRAINT fk_assignment_runs_actor FOREIGN KEY (actor_id) REFERENCES users(id) NOT VALID")

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
