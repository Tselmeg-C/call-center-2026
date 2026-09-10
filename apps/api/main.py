from datetime import datetime, timedelta, timezone
from copy import deepcopy
from contextlib import contextmanager
from secrets import token_urlsafe
from typing import Annotated

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pwdlib import PasswordHash

app = FastAPI(title="Call Center API", version="0.1.0")
password_hash = PasswordHash.recommended()
SESSION_SECONDS = 8 * 60 * 60


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
    return JSONResponse({"detail": "Invalid request."}, status_code=422)


class User(BaseModel):
    id: str
    name: str
    email: str
    role: str
    active: bool = True


class Customer(BaseModel):
    bcn: str
    name: str
    ownerId: str | None
    ownerName: str | None
    status: str
    histories: list[dict] = []


class AssignmentRequest(BaseModel):
    ownerId: str | None
    submissionId: str = Field(min_length=1)
    expectedVersion: int | None = None


class Login(BaseModel):
    email: str
    password: str = Field(min_length=12, max_length=128)


class MemoryRepo:
    def __init__(self) -> None:
        self.users: dict[str, dict] = {}
        self.sessions: dict[str, tuple[str, datetime]] = {}
        self.customers: dict[str, dict] = {
            "000123": {"bcn": "000123", "name": "Acme North", "ownerId": "sales-river", "ownerName": "River Sales", "status": "Open", "histories": []},
            "000124": {"bcn": "000124", "name": "Acme North", "ownerId": "sales-sky", "ownerName": "Sky Sales", "status": "Closed", "histories": []},
            "000125": {"bcn": "000125", "name": "Beta Works", "ownerId": None, "ownerName": None, "status": "Open", "histories": []},
        }
        self.reset()

    def reset(self) -> None:
        self.users.clear(); self.sessions.clear()

    @contextmanager
    def transaction(self):
        snapshot = (deepcopy(self.users), deepcopy(self.sessions))
        try:
            yield self
        except Exception:
            self.users, self.sessions = snapshot
            raise


repo = MemoryRepo()


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    if request.method in {"POST", "PATCH", "PUT", "DELETE"} and request.url.path != "/session/login":
        origin = request.headers.get("origin")
        referer = request.headers.get("referer", "")
        if origin not in {"http://localhost:3000", "http://127.0.0.1:3000"} and not referer.startswith("http://localhost:3000/") and not referer.startswith("http://127.0.0.1:3000/"):
            return Response("Origin not allowed.", status_code=403, media_type="application/json")
    return await call_next(request)


def safe_email(value: str) -> str:
    return value.strip().casefold()


def current_user(session: Annotated[str | None, Cookie(alias="call_center_session")] = None) -> User:
    if not session or session not in repo.sessions:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required.")
    user_id, expires = repo.sessions[session]
    if datetime.now(timezone.utc) >= expires or not repo.users.get(user_id, {}).get("active", False):
        repo.sessions.pop(session, None)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required.")
    return User.model_validate(repo.users[user_id])


@app.post("/session/login", response_model=User)
def login(body: Login, request: Request, response: Response) -> User:
    record = next((u for u in repo.users.values() if u["email"] == safe_email(body.email)), None)
    if not record or not record["active"] or not password_hash.verify(body.password, record["password"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unable to sign in.")
    token = token_urlsafe(32); repo.sessions[token] = (record["id"], datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS))
    response.set_cookie("call_center_session", token, httponly=True, samesite="lax", secure=request.url.hostname not in {"localhost", "127.0.0.1"}, path="/", max_age=SESSION_SECONDS)
    return User.model_validate(record)


@app.post("/session/logout", status_code=204)
def logout(response: Response, session: Annotated[str | None, Cookie(alias="call_center_session")] = None) -> None:
    if session: repo.sessions.pop(session, None)
    response.delete_cookie("call_center_session", path="/")


@app.get("/session/me", response_model=User)
def me(user: Annotated[User, Depends(current_user)]) -> User:
    return user


@app.get("/customers", response_model=list[Customer])
def list_customers(user: Annotated[User, Depends(current_user)]) -> list[Customer]:
    return [Customer.model_validate(row) for row in repo.customers.values()]


@app.get("/customers/{bcn}", response_model=Customer)
def get_customer(bcn: str, user: Annotated[User, Depends(current_user)]) -> Customer:
    row = repo.customers.get(bcn)
    if not row: raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found.")
    return Customer.model_validate(row)


@app.post("/admin/assignments/manual/{bcn}", response_model=Customer)
def assign_customer(bcn: str, body: AssignmentRequest, user: Annotated[User, Depends(current_user)]) -> Customer:
    if user.role != "Admin": raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required.")
    row = repo.customers.get(bcn)
    if not row: raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found.")
    if body.ownerId and not any(item["id"] == body.ownerId and item["role"] == "Sales" and item["active"] for item in repo.users.values()): raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Owner must be an active Sales user.")
    if row["ownerId"] == body.ownerId: return Customer.model_validate(row)
    old = row["ownerId"]; owner = repo.users.get(body.ownerId) if body.ownerId else None
    row["ownerId"] = body.ownerId; row["ownerName"] = owner["name"] if owner else None
    row["histories"].append({"kind": "Assignment", "actor": user.name, "actorId": user.id, "oldOwner": old, "newOwner": body.ownerId, "reason": "Manual assignment", "timestamp": datetime.now(timezone.utc).isoformat()})
    return Customer.model_validate(row)


class Provision(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    role: str = "Admin"
    password: str = Field(min_length=12, max_length=128)


class ResetPassword(BaseModel):
    password: str = Field(min_length=12, max_length=128)


def provision_user(data: Provision) -> User:
    email = safe_email(data.email)
    if any(item["email"] == email for item in repo.users.values()):
        raise ValueError("normalized identity already exists")
    if data.role not in {"Admin", "Sales"}:
        raise ValueError("invalid role")
    record = {"id": f"user-{len(repo.users) + 1}", "name": data.name, "email": email, "role": data.role, "active": True, "password": password_hash.hash(data.password)}
    repo.users[record["id"]] = record
    return User.model_validate(record)


@app.post("/operator/provision", response_model=User, include_in_schema=False)
def operator_provision(data: Provision) -> User:
    if repo.users:
        raise HTTPException(status.HTTP_409_CONFLICT, "Initial Admin already provisioned.")
    try:
        return provision_user(data)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@app.post("/operator/reset-password/{user_id}", response_model=User, include_in_schema=False)
def operator_reset_password(user_id: str, data: ResetPassword) -> User:
    record = repo.users.get(user_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    record["password"] = password_hash.hash(data.password)
    for token, (owner, _) in list(repo.sessions.items()):
        if owner == user_id: repo.sessions.pop(token, None)
    return User.model_validate(record)
