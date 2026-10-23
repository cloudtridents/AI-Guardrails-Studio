"""API routes for guardrail metrics dashboard."""

from fastapi import APIRouter

from app.services import metrics_store

router = APIRouter()


@router.get("/")
async def get_metrics():
    """Get aggregated metrics summary."""
    return metrics_store.get_metrics_summary()


@router.delete("/")
async def clear_metrics():
    """Clear all metrics data."""
    metrics_store.clear_metrics()
    return {"message": "Metrics cleared"}
