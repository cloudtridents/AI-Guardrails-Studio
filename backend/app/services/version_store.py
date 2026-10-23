"""Service for tracking configuration version history."""

import json
import time
from pathlib import Path
from typing import Optional

VERSIONS_DIR = Path(__file__).parent.parent.parent / "versions"


def _ensure_dir():
    VERSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _versions_path(config_id: str) -> Path:
    return VERSIONS_DIR / f"{config_id}.json"


def save_version(config_id: str, config_data: dict, message: str = "") -> dict:
    """Save a version snapshot of a configuration."""
    _ensure_dir()
    path = _versions_path(config_id)

    versions = []
    if path.exists():
        versions = json.loads(path.read_text())

    version_num = len(versions) + 1
    entry = {
        "version": version_num,
        "timestamp": time.time(),
        "message": message or f"Version {version_num}",
        "data": config_data,
    }
    versions.append(entry)
    path.write_text(json.dumps(versions, indent=2))
    return entry


def list_versions(config_id: str) -> list[dict]:
    """List all versions of a configuration."""
    _ensure_dir()
    path = _versions_path(config_id)
    if not path.exists():
        return []
    versions = json.loads(path.read_text())
    # Return summaries without full data
    return [
        {
            "version": v["version"],
            "timestamp": v["timestamp"],
            "message": v["message"],
        }
        for v in versions
    ]


def get_version(config_id: str, version_num: int) -> Optional[dict]:
    """Get a specific version of a configuration."""
    _ensure_dir()
    path = _versions_path(config_id)
    if not path.exists():
        return None
    versions = json.loads(path.read_text())
    for v in versions:
        if v["version"] == version_num:
            return v
    return None
