"""Keep durable import history pages bounded under load."""
from alembic import op

revision = "022_import_query_indexes"
down_revision = "021_query_indexes"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.create_index("ix_import_jobs_actor_created", "import_jobs", ["actor_id", "created_at"])
        op.create_index("ix_import_errors_job_row", "import_row_errors", ["job_id", "row_number"])

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
