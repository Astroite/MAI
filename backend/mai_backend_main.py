"""PyInstaller / Tauri sidecar entrypoint for the MAI backend.

This wraps `uvicorn.run` so the produced binary can be launched by the Tauri
shell with `--host` and `--port` flags. It deliberately stays small — the real
application is `app.main:app`.
"""
from __future__ import annotations

import argparse
import os
import sys


def _ensure_standard_streams() -> None:
    """PyInstaller windowed apps may start with std streams set to None."""
    if sys.stdin is None:
        sys.stdin = open(os.devnull, "r", encoding="utf-8")
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(prog="mai-backend")
    parser.add_argument("--host", default=os.environ.get("MAI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MAI_PORT", "0")))
    parser.add_argument(
        "--log-level",
        default=os.environ.get("MAI_LOG_LEVEL", "warning"),
        choices=("critical", "error", "warning", "info", "debug", "trace"),
    )
    args = parser.parse_args()

    # Tauri sets these before spawning us, but allow direct invocation too.
    os.environ.setdefault("MAI_PACKAGED", "1")
    _ensure_standard_streams()

    # Import lazily after MAI_PACKAGED is set so packaged defaults resolve to
    # the user data directory instead of the install directory.
    from app.main import app as fastapi_app

    import uvicorn

    if args.port == 0:
        # Ephemeral port: bind, read, drop, and let uvicorn re-bind the same one.
        # Tauri normally pre-resolves this and passes a real number; this branch
        # is here for direct CLI smoke-testing.
        import socket

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind((args.host, 0))
        args.port = sock.getsockname()[1]
        sock.close()
        print(f"mai-backend listening on http://{args.host}:{args.port}", flush=True)

    uvicorn.run(
        fastapi_app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        access_log=False,
        # Tauri owns the process lifecycle; we never need a reloader here.
        reload=False,
    )


if __name__ == "__main__":
    sys.exit(main())
