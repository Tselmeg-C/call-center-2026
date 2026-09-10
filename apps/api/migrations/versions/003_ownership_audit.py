from alembic import op
import sqlalchemy as sa

revision = "003_ownership_audit"
down_revision = "002_customers"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("assignment_rules", sa.Column("id", sa.String(120), primary_key=True), sa.Column("name", sa.String(120), nullable=False, unique=True), sa.Column("position", sa.Integer, nullable=False), sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()), sa.Column("version", sa.Integer, nullable=False, server_default="0"))
    op.create_table("assignment_rule_members", sa.Column("rule_id", sa.String(120), sa.ForeignKey("assignment_rules.id", ondelete="CASCADE"), primary_key=True), sa.Column("user_id", sa.String(120), sa.ForeignKey("users.id"), primary_key=True))
    op.create_table("assignment_history", sa.Column("id", sa.BigInteger, primary_key=True), sa.Column("bcn", sa.String(64), sa.ForeignKey("customers.bcn"), nullable=False), sa.Column("actor_id", sa.String(120), sa.ForeignKey("users.id")), sa.Column("old_owner_id", sa.String(120)), sa.Column("new_owner_id", sa.String(120)), sa.Column("reason", sa.String(255), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("audit_events", sa.Column("id", sa.BigInteger, primary_key=True), sa.Column("actor_id", sa.String(120), sa.ForeignKey("users.id")), sa.Column("action", sa.String(120), nullable=False), sa.Column("target", sa.String(255), nullable=False), sa.Column("details", sa.JSON, nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))

def downgrade():
    op.drop_table("audit_events"); op.drop_table("assignment_history"); op.drop_table("assignment_rule_members"); op.drop_table("assignment_rules")
