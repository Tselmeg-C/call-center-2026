from alembic import op
import sqlalchemy as sa

revision = "006_rule_owner"
down_revision = "005_assignment_runs"
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table("assignment_rules") as batch:
        batch.add_column(sa.Column("owner_id", sa.String(120), nullable=True))
        batch.create_foreign_key("fk_assignment_rules_owner", "users", ["owner_id"], ["id"])

def downgrade():
    with op.batch_alter_table("assignment_rules") as batch:
        batch.drop_constraint("fk_assignment_rules_owner", type_="foreignkey")
        batch.drop_column("owner_id")
