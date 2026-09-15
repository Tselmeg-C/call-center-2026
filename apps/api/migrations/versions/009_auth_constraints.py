"""Enforce identity and digest-backed session invariants."""
from alembic import op

revision = "009_auth_constraints"
down_revision = "008_assignment_settings"
branch_labels = None
depends_on = None


def upgrade():
    # SQLite remains a lightweight legacy test adapter; acceptance uses PostgreSQL.
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_check_constraint("users_role_valid", "users", "role IN ('Admin', 'Sales')")
    # The application casefolds email before storage. PostgreSQL's lower() is
    # locale-dependent, so constrain persisted identities to canonical ASCII.
    op.create_check_constraint("users_email_normalized", "users", "email !~ '[^[:ascii:]]' AND email !~ '[[:space:]]' AND email = lower(email) AND length(email) >= 3")
    op.create_check_constraint("users_name_present", "users", "length(btrim(name)) > 0")
    op.create_check_constraint("users_password_hash", "users", "password_hash LIKE '$argon2id$%' AND length(password_hash) > 60")
    op.create_check_constraint("sessions_digest_valid", "sessions", "digest ~ '^[0-9a-f]{64}$'")
    op.create_check_constraint("sessions_expiry_valid", "sessions", "expires_at > issued_at")
    op.create_check_constraint("sessions_revocation_valid", "sessions", "revoked_at IS NULL OR revoked_at >= issued_at")


def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
