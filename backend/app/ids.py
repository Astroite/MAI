from uuid import NAMESPACE_URL, UUID, uuid5

from uuid6 import uuid7


def new_id() -> str:
    return str(uuid7())


def builtin_id(kind: str, key: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"mai:{kind}:{key}"))


def ensure_uuid(value: str) -> str:
    return str(UUID(value))

