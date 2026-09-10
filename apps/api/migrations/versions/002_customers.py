from alembic import op
import sqlalchemy as sa

revision = "002_customers"
down_revision = "001_auth"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("customers", sa.Column("bcn", sa.String(64), primary_key=True), sa.Column("name", sa.String(255), nullable=False), sa.Column("status", sa.String(16), nullable=False, server_default="Open"), sa.Column("owner_id", sa.String(120), sa.ForeignKey("users.id")), sa.Column("source", sa.JSON, nullable=False, server_default="{}"), sa.Column("version", sa.Integer, nullable=False, server_default="0"))
    op.create_table("customer_phones", sa.Column("id", sa.Integer, primary_key=True), sa.Column("bcn", sa.String(64), sa.ForeignKey("customers.bcn", ondelete="CASCADE"), nullable=False), sa.Column("phone", sa.String(64), nullable=False), sa.Column("is_primary", sa.Boolean, nullable=False, server_default=sa.false()))
    op.create_table("import_jobs", sa.Column("id", sa.String(120), primary_key=True), sa.Column("submission_id", sa.String(120), nullable=False, unique=True), sa.Column("actor_id", sa.String(120), sa.ForeignKey("users.id"), nullable=False), sa.Column("filename", sa.String(255), nullable=False), sa.Column("processed", sa.Integer, nullable=False), sa.Column("created", sa.Integer, nullable=False), sa.Column("updated", sa.Integer, nullable=False), sa.Column("error_rows", sa.Integer, nullable=False), sa.Column("status", sa.String(16), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("import_row_errors", sa.Column("id", sa.Integer, primary_key=True), sa.Column("job_id", sa.String(120), sa.ForeignKey("import_jobs.id", ondelete="CASCADE"), nullable=False), sa.Column("row_number", sa.Integer, nullable=False), sa.Column("field", sa.String(120), nullable=False), sa.Column("reason", sa.String(255), nullable=False))

def downgrade():
    op.drop_table("import_row_errors"); op.drop_table("import_jobs"); op.drop_table("customer_phones"); op.drop_table("customers")
