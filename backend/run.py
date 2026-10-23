#!/usr/bin/env python3
"""Launcher for the backend on filesystems where the venv symlinks are missing.

The project lives on an exFAT volume, which does not support symlinks, so the
virtualenv's ``bin/python`` symlink is absent and ``include-system-site-packages``
cannot be honored the usual way. Running the system interpreter against the
venv's site-packages also leaks the system ``dist-packages`` onto ``sys.path``,
which pulls in an old scipy/numpy that breaks transformers.

This launcher reproduces a clean venv path: venv site-packages + stdlib only,
with the system ``dist-packages`` stripped out. Run it with the system python:

    python3 run.py                # serve on :9000
    python3 run.py --port 8000    # custom port
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SITE = os.path.join(_HERE, "venv", "lib", "python3.12", "site-packages")

# Strip system dist-packages, then prepend the venv's site-packages.
sys.path = [p for p in sys.path if "dist-packages" not in p]
if _SITE not in sys.path:
    sys.path.insert(0, _SITE)

# Make 'app' importable and ensure cwd-relative file stores resolve correctly.
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
os.chdir(_HERE)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Run the Guardrails backend")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
