"""Service for persisting chat sessions."""

import json
import time
import uuid
from pathlib import Path
from typing import Optional

SESSIONS_DIR = Path(__file__).parent.parent.parent / "sessions"


def _ensure_dir():
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _session_path(session_id: str) -> Path:
    return SESSIONS_DIR / f"{session_id}.json"


def create_session(agent_id: str, name: str = "") -> dict:
    """Create a new chat session."""
    _ensure_dir()
    session_id = str(uuid.uuid4())[:8]
    session = {
        "id": session_id,
        "agent_id": agent_id,
        "name": name or f"Session {session_id}",
        "messages": [],
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    _session_path(session_id).write_text(json.dumps(session, indent=2))
    return session


def get_session(session_id: str) -> Optional[dict]:
    """Get a session by ID."""
    path = _session_path(session_id)
    if not path.exists():
        return None
    return json.loads(path.read_text())


def list_sessions(agent_id: Optional[str] = None) -> list[dict]:
    """List all sessions, optionally filtered by agent."""
    _ensure_dir()
    sessions = []
    for file in sorted(SESSIONS_DIR.glob("*.json"), reverse=True):
        try:
            data = json.loads(file.read_text())
            if agent_id and data.get("agent_id") != agent_id:
                continue
            sessions.append({
                "id": data["id"],
                "agent_id": data["agent_id"],
                "name": data.get("name", ""),
                "message_count": len(data.get("messages", [])),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
            })
        except (json.JSONDecodeError, KeyError):
            continue
    return sessions


def add_message(session_id: str, message: dict) -> bool:
    """Add a message to a session."""
    session = get_session(session_id)
    if not session:
        return False
    session["messages"].append(message)
    session["updated_at"] = time.time()
    _session_path(session_id).write_text(json.dumps(session, indent=2))
    return True


def delete_session(session_id: str) -> bool:
    """Delete a session."""
    path = _session_path(session_id)
    if path.exists():
        path.unlink()
        return True
    return False
