from alembic import op
import sqlalchemy as sa

revision = "008_assignment_settings"
down_revision = "007_query_indexes"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("assignment_settings", sa.Column("key", sa.String(120), primary_key=True), sa.Column("value", sa.JSON, nullable=False))

def downgrade():
    op.drop_table("assignment_settings")
