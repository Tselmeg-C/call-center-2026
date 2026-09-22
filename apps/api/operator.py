"""Database-backed local operator console; secrets are never echoed."""
from getpass import getpass
from fastapi import HTTPException
from pydantic import ValidationError


def main() -> None:
    try:
        from .main import Provision, ResetPassword, provision_user, operator_reset_password, storage_mode, safe_email, recovery_token
        action = input("operator action [provision/reset/recovery-token]: ").strip().lower()
        if action == "recovery-token":
            # #73: pure crypto over OPERATOR_RECOVERY_SECRET -- no DB access needed, unlike
            # provision/reset below, so this can be run from anywhere that env var is set
            # (including an environment with no DB/shell access to the target deployment) to
            # produce a token for POST /operator/recover against a locked-out real deployment.
            email = safe_email(input("account email to recover: "))
            ttl_raw = input("token lifetime in seconds [900]: ").strip()
            ttl = int(ttl_raw) if ttl_raw else 900
            print(f"Paste into X-Operator-Recovery-Token (expires in {ttl}s):")
            print(recovery_token(email, ttl))
            return
        if storage_mode != "postgres":
            raise SystemExit("Use the running API's same-process console for memory storage.")
        if action == "provision":
            name = input("name: ")
            email = input("email: ")
            provision_user(Provision(name=name, email=email, role="Admin", password=getpass("new password: ")))
        elif action == "reset":
            user_id = input("user id: ").strip()
            operator_reset_password(user_id, ResetPassword(password=getpass("new password: ")))
        else:
            raise SystemExit("Invalid operator action.")
    except (HTTPException, ValidationError, ValueError):
        raise SystemExit("Operator request rejected.") from None
    except Exception:
        raise SystemExit("Storage operation failed.") from None
    print("Operator request completed.")


if __name__ == "__main__": main()
