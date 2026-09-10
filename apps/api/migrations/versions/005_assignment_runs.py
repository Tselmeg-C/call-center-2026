from alembic import op
import sqlalchemy as sa

revision = "005_assignment_runs"
down_revision = "004_activity_lifecycle"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("assignment_runs", sa.Column("submission_id", sa.String(120), primary_key=True), sa.Column("scope", sa.String(32), nullable=False), sa.Column("result", sa.JSON, nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))

def downgrade():
    op.drop_table("assignment_runs")
