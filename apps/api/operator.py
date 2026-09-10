"""Same-process operator console; secret input is never echoed or passed as an argument."""
from getpass import getpass

from .main import Provision, provision_user, repo


def main() -> None:
    action = input("operator action [provision/reset]: ").strip().lower()
    user_id = input("user id (blank for provision): ").strip()
    password = getpass("new password: ")
    if action == "provision":
        user = provision_user(Provision(name=input("name: "), email=input("email: "), role="Admin", password=password))
    else:
        if user_id not in repo.users: raise SystemExit("user not found")
        repo.users[user_id]["password"] = __import__(".main", fromlist=["password_hash"]).password_hash.hash(password)
        user = repo.users[user_id]
    print(f"updated {user['id']}")


if __name__ == "__main__": main()
