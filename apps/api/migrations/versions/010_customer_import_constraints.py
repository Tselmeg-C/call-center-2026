"""Tighten customer import identity and relationship constraints."""
from alembic import op
import sqlalchemy as sa

revision = "010_customer_import_constraints"
down_revision = "009_auth_constraints"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.alter_column("customers", "bcn", existing_type=sa.String(64), type_=sa.String(128), existing_nullable=False)
    op.create_check_constraint("customers_bcn_present", "customers", "length(btrim(bcn)) > 0")
    op.create_check_constraint("customers_name_present", "customers", "length(btrim(name)) > 0")
    op.create_check_constraint("customers_status_valid", "customers", "status IN ('Open', 'Closed')")
    op.create_check_constraint("customer_phones_present", "customer_phones", "length(btrim(phone)) > 0")


def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
