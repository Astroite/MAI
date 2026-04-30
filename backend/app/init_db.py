import asyncio

from .db import create_schema
from .seed import seed_builtins
from .db import SessionLocal


async def main() -> None:
    await create_schema()
    async with SessionLocal() as session:
        await seed_builtins(session)
    print("database schema created and built-ins seeded")


if __name__ == "__main__":
    asyncio.run(main())

