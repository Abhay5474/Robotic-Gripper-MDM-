"""Thin RTDB client abstraction.

All domain logic lives in store.py on top of this interface, so the same code is
exercised against the in-memory implementation in tests and against Firebase in
production. Only these primitives touch the database.
"""
from __future__ import annotations

import copy
import json
import threading
from typing import Any, Callable, Optional, Protocol

from .config import Settings


class RtdbError(Exception):
    """The database could not be reached or rejected the operation."""


class TransactionAbort(Exception):
    """Raised by a transaction function to leave the value untouched."""


class RtdbClient(Protocol):
    def get(self, path: str) -> Any: ...
    def set(self, path: str, value: Any) -> None: ...
    def update(self, path: str, values: dict[str, Any]) -> None: ...
    def delete(self, path: str) -> None: ...
    def transaction(self, path: str, fn: Callable[[Any], Any]) -> tuple[bool, Any]: ...
    def query_equal(self, path: str, child: str, value: Any) -> dict[str, Any]: ...
    def query_last(self, path: str, order_child: str, limit: int) -> dict[str, Any]: ...
    def ping(self) -> None: ...


def _parts(path: str) -> list[str]:
    return [p for p in path.split("/") if p]


class MemoryRtdb:
    """In-process RTDB emulation (thread-safe, atomic transactions, fault injection)."""

    def __init__(self) -> None:
        self._root: dict[str, Any] = {}
        self._lock = threading.RLock()
        self.fail_with: Optional[Exception] = None  # raise on every call while set
        self.calls: list[tuple[str, str]] = []

    def _enter(self, op: str, path: str) -> None:
        self.calls.append((op, path))
        if self.fail_with is not None:
            raise self.fail_with

    def _node(self, parts: list[str], create: bool = False) -> Any:
        cur: Any = self._root
        for p in parts:
            if not isinstance(cur, dict):
                return None
            if p not in cur:
                if not create:
                    return None
                cur[p] = {}
            cur = cur[p]
        return cur

    def get(self, path: str) -> Any:
        with self._lock:
            self._enter("get", path)
            return copy.deepcopy(self._node(_parts(path)))

    def _set(self, path: str, value: Any) -> None:
        parts = _parts(path)
        if not parts:
            self._root = copy.deepcopy(value) or {}
            return
        parent = self._node(parts[:-1], create=True)
        if not isinstance(parent, dict):
            raise RtdbError(f"cannot write below scalar at {path}")
        if value is None:
            parent.pop(parts[-1], None)
        else:
            parent[parts[-1]] = copy.deepcopy(value)

    def set(self, path: str, value: Any) -> None:
        with self._lock:
            self._enter("set", path)
            self._set(path, value)

    def update(self, path: str, values: dict[str, Any]) -> None:
        with self._lock:
            self._enter("update", path)
            for k, v in values.items():
                self._set(f"{path}/{k}", v)

    def delete(self, path: str) -> None:
        with self._lock:
            self._enter("delete", path)
            self._set(path, None)

    def transaction(self, path: str, fn: Callable[[Any], Any]) -> tuple[bool, Any]:
        with self._lock:
            self._enter("transaction", path)
            current = copy.deepcopy(self._node(_parts(path)))
            try:
                new = fn(current)
            except TransactionAbort:
                return False, current
            self._set(path, new)
            return True, copy.deepcopy(new)

    def query_equal(self, path: str, child: str, value: Any) -> dict[str, Any]:
        with self._lock:
            self._enter("query_equal", path)
            node = self._node(_parts(path)) or {}
            return {k: copy.deepcopy(v) for k, v in node.items() if isinstance(v, dict) and v.get(child) == value}

    def query_last(self, path: str, order_child: str, limit: int) -> dict[str, Any]:
        with self._lock:
            self._enter("query_last", path)
            node = self._node(_parts(path)) or {}
            items = [(k, v) for k, v in node.items() if isinstance(v, dict)]
            items.sort(key=lambda kv: kv[1].get(order_child) or 0)
            return {k: copy.deepcopy(v) for k, v in items[-limit:]}

    def ping(self) -> None:
        with self._lock:
            self._enter("ping", "/")


class FirebaseRtdb:
    """Firebase Admin SDK adapter. Translates SDK/network errors into RtdbError."""

    def __init__(self, settings: Settings):
        import firebase_admin
        from firebase_admin import credentials, db

        if not settings.firebase_database_url:
            raise RtdbError("FIREBASE_DATABASE_URL is not set.")
        if settings.firebase_credentials_json is not None:
            cred = credentials.Certificate(json.loads(settings.firebase_credentials_json.get_secret_value()))
        elif settings.firebase_credentials_path:
            cred = credentials.Certificate(settings.firebase_credentials_path)
        else:
            cred = credentials.ApplicationDefault()
        try:
            self._app = firebase_admin.get_app()
        except ValueError:
            self._app = firebase_admin.initialize_app(cred, {"databaseURL": settings.firebase_database_url})
        self._db = db

    def _ref(self, path: str):
        return self._db.reference("/" + "/".join(_parts(path)), app=self._app)

    def _wrap(self, fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except TransactionAbort:
            raise
        except Exception as e:  # SDK raises FirebaseError / requests errors / TransactionAbortedError
            raise RtdbError(f"{type(e).__name__}: {e}") from e

    def get(self, path: str) -> Any:
        return self._wrap(lambda: self._ref(path).get())

    def set(self, path: str, value: Any) -> None:
        self._wrap(lambda: self._ref(path).set(value) if value is not None else self._ref(path).delete())

    def update(self, path: str, values: dict[str, Any]) -> None:
        self._wrap(lambda: self._ref(path).update(values))

    def delete(self, path: str) -> None:
        self._wrap(lambda: self._ref(path).delete())

    def transaction(self, path: str, fn: Callable[[Any], Any]) -> tuple[bool, Any]:
        try:
            new = self._wrap(lambda: self._ref(path).transaction(fn))
            return True, new
        except TransactionAbort:
            return False, self.get(path)

    def query_equal(self, path: str, child: str, value: Any) -> dict[str, Any]:
        return self._wrap(lambda: self._ref(path).order_by_child(child).equal_to(value).get()) or {}

    def query_last(self, path: str, order_child: str, limit: int) -> dict[str, Any]:
        return self._wrap(lambda: self._ref(path).order_by_child(order_child).limit_to_last(limit).get()) or {}

    def ping(self) -> None:
        self._wrap(lambda: self._ref("/_health_probe").get(shallow=True))
