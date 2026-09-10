# Release and recovery

Keep development and production Railway projects, databases, origins, and secrets separate. Record the deployed commit and Alembic revision, take a provider-managed backup before migrations, restore into an isolated database, run readiness and synthetic smoke checks, then switch traffic. Never place credentials, dumps, or customer contents in evidence.
