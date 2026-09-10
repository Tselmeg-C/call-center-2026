from alembic import op
import sqlalchemy as sa

revision = "004_activity_lifecycle"
down_revision = "003_ownership_audit"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("closure_reasons", sa.Column("id", sa.String(120), primary_key=True), sa.Column("label", sa.String(120), nullable=False, unique=True), sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()))
    op.create_table("activities", sa.Column("id", sa.String(120), primary_key=True), sa.Column("bcn", sa.String(64), sa.ForeignKey("customers.bcn"), nullable=False), sa.Column("actor_id", sa.String(120), sa.ForeignKey("users.id"), nullable=False), sa.Column("kind", sa.String(32), nullable=False), sa.Column("outcome", sa.String(32)), sa.Column("text", sa.Text), sa.Column("deleted_at", sa.DateTime(timezone=True)), sa.Column("deleted_by", sa.String(120)), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("follow_ups", sa.Column("id", sa.String(120), primary_key=True), sa.Column("bcn", sa.String(64), sa.ForeignKey("customers.bcn"), nullable=False), sa.Column("actor_id", sa.String(120), sa.ForeignKey("users.id"), nullable=False), sa.Column("type", sa.String(32), nullable=False), sa.Column("due", sa.DateTime(timezone=True)), sa.Column("note", sa.Text), sa.Column("status", sa.String(16), nullable=False), sa.Column("version", sa.Integer, nullable=False, server_default="0"), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("idempotency_records", sa.Column("actor_id", sa.String(120), sa.ForeignKey("users.id"), primary_key=True), sa.Column("operation", sa.String(80), primary_key=True), sa.Column("submission_id", sa.String(120), primary_key=True), sa.Column("fingerprint", sa.String(128), nullable=False), sa.Column("result", sa.JSON, nullable=False), sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False))

def downgrade():
    op.drop_table("idempotency_records"); op.drop_table("follow_ups"); op.drop_table("activities"); op.drop_table("closure_reasons")
