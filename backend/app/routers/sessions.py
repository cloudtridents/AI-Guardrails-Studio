"""API routes for chat session management."""

from fastapi import APIRouter, HTTPException
from typing import Optional

from app.services import session_store

router = APIRouter()


@router.get("/")
async def list_sessions(agent_id: Optional[str] = None):
    """List all sessions, optionally filtered by agent."""
    return session_store.list_sessions(agent_id)


@router.post("/")
async def create_session(data: dict):
    """Create a new session."""
    agent_id = data.get("agent_id", "")
    name = data.get("name", "")
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required")
    return session_store.create_session(agent_id, name)


@router.get("/{session_id}")
async def get_session(session_id: str):
    """Get a session with all messages."""
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/{session_id}/messages")
async def add_message(session_id: str, message: dict):
    """Add a message to a session."""
    if not session_store.add_message(session_id, message):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok"}


@router.delete("/{session_id}")
async def delete_session(session_id: str):
    """Delete a session."""
    if not session_store.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session deleted"}
