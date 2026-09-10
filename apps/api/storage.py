import os

def mode() -> str:
    value = os.getenv("CALL_CENTER_STORAGE", "memory").casefold()
    if value not in {"memory", "postgres"}:
        raise RuntimeError("CALL_CENTER_STORAGE must be memory or postgres")
    if value == "postgres" and not os.getenv("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL is required for postgres storage")
    return value
