from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from typing import Annotated

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from pwdlib import PasswordHash

app = FastAPI(title="Call Center API", version="0.1.0")
password_hash = PasswordHash.recommended()
SESSION_SECONDS = 8 * 60 * 60


class User(BaseModel):
    id: str
    name: str
    email: str
    role: str
    active: bool = True


class Login(BaseModel):
    email: str
    password: str


class MemoryRepo:
    def __init__(self) -> None:
        self.users: dict[str, dict] = {}
        self.sessions: dict[str, tuple[str, datetime]] = {}
        self.reset()

    def reset(self) -> None:
        self.users.clear(); self.sessions.clear()


repo = MemoryRepo()


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
def login(body: Login, response: Response) -> User:
    record = next((u for u in repo.users.values() if u["email"] == safe_email(body.email)), None)
    if not record or not record["active"] or not password_hash.verify(body.password, record["password"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unable to sign in.")
    token = token_urlsafe(32); repo.sessions[token] = (record["id"], datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS))
    response.set_cookie("call_center_session", token, httponly=True, samesite="lax", secure=False, path="/", max_age=SESSION_SECONDS)
    return User.model_validate(record)


@app.post("/session/logout", status_code=204)
def logout(response: Response, session: Annotated[str | None, Cookie(alias="call_center_session")] = None) -> None:
    if session: repo.sessions.pop(session, None)
    response.delete_cookie("call_center_session", path="/")


@app.get("/session/me", response_model=User)
def me(user: Annotated[User, Depends(current_user)]) -> User:
    return user
