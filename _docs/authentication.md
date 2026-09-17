# Authentication policy

The prototype uses email/password sign-in in the eventual backend. Sessions are absolute for eight hours; logout, password reset, deactivation, and role changes revoke the current session. Failed login responses are generic. There is no public registration: an operator provisions the initial Admin and recovers passwords through a command that reads secret input without echoing it. Mock screens request no passwords and contain synthetic personas only.

## Sign-in and operator input rules (API)

A malformed body returns `422 {"detail": "Invalid request."}`, is not counted by the login throttle and never says whether an account exists. Unknown fields are rejected.

- `POST /session/login`: `email` is a string of 3-254 characters with no format rule (it is trimmed and casefolded before lookup, so any stored account still signs in). `password` is a string of 12-128 characters and is never trimmed.
- `POST /operator/provision`: same rules as `POST /admin/users` (see administration.md); `role` defaults to `Admin`. A well-formed body with a wrong or missing `x-operator-secret` is `401`.
- `POST /operator/reset-password/{id}` (memory mode, `CALL_CENTER_ENABLE_OPERATOR_RESET` only): only `password`, 12-128 characters.
