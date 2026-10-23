"""API routes for interactive guardrail testing via chat."""

from fastapi import APIRouter, HTTPException

from app.models.schemas import ChatRequest, ChatResponse
from app.services import config_store
from app.services.guardrails_runner import run_guardrails

router = APIRouter()


@router.post("/", response_model=ChatResponse)
async def test_guardrails(request: ChatRequest):
    """Send a message through the guardrails for testing."""
    config = config_store.get_config(request.config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    response = await run_guardrails(
        config=config,
        message=request.message,
        history=request.history,
    )
    return response
