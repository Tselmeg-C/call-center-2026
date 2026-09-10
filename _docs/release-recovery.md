# Release and recovery

Keep development and production Railway projects, databases, origins, and secrets separate. Record the deployed commit and Alembic revision, take a provider-managed backup before migrations, restore into an isolated database, run readiness and synthetic smoke checks, then switch traffic. Never place credentials, dumps, or customer contents in evidence.

MVP recovery targets are RPO 24 hours and RTO 4 hours. Daily encrypted backups should be retained for 30 days; audit history is retained for at least 365 days and is not automatically purged. A release record must include backup age, restore duration, schema revision, readiness evidence, and synthetic smoke results before production promotion.

For a development rehearsal, restore the provider backup into a new isolated database, set its connection as `DATABASE_URL`, and run `CALL_CENTER_STORAGE=postgres apps/api/start.sh`; the startup migration gate must complete before the readiness check. Record only the backup identifier, backup age, elapsed restore-to-ready time, Alembic revision, row counts, and synthetic smoke pass/fail. Never target a running database during restore, and never record the connection value or dump contents.
