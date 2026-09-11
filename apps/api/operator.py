"""Database-backed local operator console; secrets are never echoed."""
from getpass import getpass
from fastapi import HTTPException
from pydantic import ValidationError


def main() -> None:
    try:
        from .main import Provision, ResetPassword, provision_user, operator_reset_password, storage_mode
        if storage_mode != "postgres":
            raise SystemExit("Use the running API's same-process console for memory storage.")
        action = input("operator action [provision/reset]: ").strip().lower()
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
