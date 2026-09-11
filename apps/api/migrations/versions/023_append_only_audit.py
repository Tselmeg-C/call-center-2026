"""Prevent ordinary application mutation of append-only history."""
from alembic import op

revision = "023_append_only_audit"
down_revision = "022_import_query_indexes"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE OR REPLACE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only history'; END; $$")
        for table in ("audit_events", "assignment_history"):
            op.execute(f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION reject_history_mutation()")

def downgrade():
    raise RuntimeError("Restore a verified backup instead of destructive down-migration.")
