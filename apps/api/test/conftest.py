import os

# #60: /operator/reset-password registers only when CALL_CENTER_STORAGE == "memory" AND this flag
# is explicitly enabled, both read once at `..main` import time. Setting it here (module scope,
# not a fixture) guarantees it lands before pytest imports test_auth.py/test_auth_adapters.py in
# this directory, so the memory-mode journeys that exercise the route over HTTP keep working.
# Tests proving the flag's *absence* 404s the route spawn their own subprocess with a clean env
# instead (see test_auth.py's test_operator_reset_password_route_requires_explicit_flag), since a
# route already registered in this process can't be un-registered by monkeypatching the env later.
os.environ.setdefault("CALL_CENTER_ENABLE_OPERATOR_RESET", "1")
