"""API routes for Audit Log."""

from typing import Optional

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.services import audit_log

router = APIRouter()


@router.get("/")
async def list_audit_entries(
    agent_id: Optional[str] = None,
    result: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    """List audit log entries with optional filters."""
    return audit_log.query(
        agent_id=agent_id,
        result=result,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )


@router.get("/summary")
async def get_audit_summary(agent_id: Optional[str] = None):
    """Get compliance summary statistics."""
    return audit_log.get_summary(agent_id=agent_id)


@router.get("/export")
async def export_audit():
    """Export audit log as CSV."""
    csv_content = audit_log.export_csv()
    return PlainTextResponse(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_log.csv"},
    )


@router.delete("/")
async def clear_audit():
    """Clear all audit log entries."""
    success = audit_log.clear()
    if success:
        return {"message": "Audit log cleared"}
    return {"message": "Failed to clear audit log", "error": True}
