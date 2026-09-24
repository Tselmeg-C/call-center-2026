"""#159: the API caps every request body at 11 MiB itself, since the dev API's public domain skips
nginx's client_max_body_size. Driven through the ASGI app directly, so the test controls
Content-Length/chunking and counts exactly how many body bytes the API pulled from `receive`."""
import asyncio
import logging
import secrets

import pytest
from fastapi.testclient import TestClient

from .. import main

LIMIT = 11 * 1024 * 1024
MIB = 1024 * 1024
SECURITY = {"strict-transport-security": "max-age=31536000", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin"}


def call(path, chunks, headers=()):
    """Send `chunks` as the body; return (status, response headers, bytes pulled from receive)."""
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http", "server": ("localhost", 80), "client": ("198.51.100.7", 1234), "root_path": "", "path": path, "raw_path": path.encode(), "query_string": b"", "headers": [(k.encode(), v.encode()) for k, v in headers]}
    pulled = 0; pending = list(chunks); sent = []

    async def receive():
        nonlocal pulled
        if not pending: return {"type": "http.disconnect"}
        chunk = pending.pop(0); pulled += len(chunk)
        return {"type": "http.request", "body": chunk, "more_body": bool(pending)}

    async def send(message): sent.append(message)

    asyncio.run(main.app(scope, receive, send))
    start = next(m for m in sent if m["type"] == "http.response.start")
    return start["status"], {k.decode(): v.decode() for k, v in start["headers"]}, pulled


@pytest.fixture
def admin_cookie():
    main.repo.reset()
    secret = secrets.token_urlsafe(24)
    main.provision_user(main.Provision(name="Admin", email="admin159@example.test", role="Admin", password=secret))
    with TestClient(main.app, base_url="http://localhost") as client:
        assert client.post("/session/login", json={"email": "admin159@example.test", "password": secret}).status_code == 200
        yield client.cookies["call_center_session"]
    main.repo.reset()


@pytest.fixture
def untouchable(monkeypatch):
    """Fail loudly if an oversized request reaches the NUL check, authentication or the login handler."""
    def boom(*_, **__): raise AssertionError("reached past the body limit")
    monkeypatch.setattr(main, "_request_has_nul", boom)
    monkeypatch.setattr(main, "client_ip", boom)
    monkeypatch.setitem(main.app.dependency_overrides, main.current_user, boom)


def variants(cookie):
    for session in (None, "invalid-session", cookie):
        for origin in ("http://localhost:3000", "https://evil.example", None):
            headers = [("x-request-id", "req-159")]
            if session: headers.append(("cookie", f"call_center_session={session}"))
            if origin: headers.append(("origin", origin))
            yield headers


def assert_413(status, headers):
    assert status == 413
    assert headers["x-request-id"] == "req-159"
    assert SECURITY.items() <= headers.items()


def test_oversized_content_length_is_413_before_reading_any_byte(admin_cookie, untouchable, caplog):
    for path, headers in ((path, headers) for path in ("/session/login", "/admin/imports", "/customers/000964/notes") for headers in variants(admin_cookie)):
        caplog.clear()
        with caplog.at_level(logging.INFO, logger=main.logger.name):
            status, response_headers, pulled = call(path, [b"x" * MIB], [*headers, ("content-length", str(LIMIT + 1))])
        assert_413(status, response_headers)
        assert pulled == 0
        lines = [r.getMessage() for r in caplog.records if "status=413" in r.getMessage()]
        assert len(lines) == 1 and lines[0].startswith("request id=req-159 method=POST") and "error=upload_limit" in lines[0]


def test_oversized_chunked_body_is_413_and_reading_stops(admin_cookie, untouchable):
    for path, headers in ((path, headers) for path in ("/session/login", "/admin/imports") for headers in variants(admin_cookie)):
        status, response_headers, pulled = call(path, [b"x" * MIB] * 50, headers)
        assert_413(status, response_headers)
        assert pulled <= LIMIT + MIB


@pytest.mark.parametrize("content_length", [True, False])
def test_exact_limit_is_not_rejected_and_one_byte_more_is(content_length):
    def send(size):
        headers = [("x-request-id", "req-159"), ("content-type", "application/json")]
        if content_length: headers.append(("content-length", str(size)))
        return call("/session/login", [b" " * MIB] * 11 + [b" " * (size - LIMIT)], headers)
    status, _, pulled = send(LIMIT)
    assert status == 422 and pulled == LIMIT  # the handler's own answer to a blank JSON body
    assert send(LIMIT + 1)[0] == 413

