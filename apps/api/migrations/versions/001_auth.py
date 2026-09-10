from alembic import op
import sqlalchemy as sa

revision = "001_auth"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("users", sa.Column("id", sa.String(120), primary_key=True), sa.Column("name", sa.String(120), nullable=False), sa.Column("email", sa.String(254), nullable=False, unique=True), sa.Column("role", sa.String(16), nullable=False), sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()), sa.Column("password_hash", sa.String(255), nullable=False))
    op.create_table("sessions", sa.Column("digest", sa.String(128), primary_key=True), sa.Column("user_id", sa.String(120), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False), sa.Column("revoked_at", sa.DateTime(timezone=True)))

def downgrade():
    op.drop_table("sessions"); op.drop_table("users")
