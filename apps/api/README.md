# Local API

Run the single-process in-memory API with `python -m pip install -r requirements.txt` and `uvicorn main:app --app-dir apps/api --reload`. State is intentionally lost on restart. The authentication surface is implemented first; business endpoints return no fabricated success until their backlog issues land.

Operator provisioning and password recovery must be attached to this same process and read secret input without echo. No credentials are accepted as command-line arguments or written to logs.
