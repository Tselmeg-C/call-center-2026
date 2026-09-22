"""#70: append-only login-failure events, shared across API replicas in postgres storage mode."""
from alembic import op
import sqlalchemy as sa

revision = "030_login_failure_events"
down_revision = "029_assignment_conditions"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("login_failure_events", sa.Column("id", sa.Integer, primary_key=True), sa.Column("email", sa.String(254), nullable=False), sa.Column("ip", sa.String(64), nullable=False), sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_login_failure_events_ip_occurred", "login_failure_events", ["ip", "occurred_at"])
    op.create_index("ix_login_failure_events_email_ip_occurred", "login_failure_events", ["email", "ip", "occurred_at"])

def downgrade():
    op.drop_table("login_failure_events")
