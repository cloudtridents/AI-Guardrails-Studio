"""API routes for A/B testing guardrail configurations."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import config_store
from app.services.ab_testing import run_ab_test

router = APIRouter()


class ABTestRequest(BaseModel):
    config_a_id: str
    config_b_id: str
    test_messages: list[str]


@router.post("/run")
async def run_ab_test_endpoint(request: ABTestRequest):
    """Run an A/B test comparing two guardrail configurations."""
    if not request.test_messages:
        raise HTTPException(status_code=400, detail="No test messages provided")

    if request.config_a_id == request.config_b_id:
        raise HTTPException(status_code=400, detail="Config A and Config B must be different")

    config_a = config_store.get_config(request.config_a_id)
    if not config_a:
        raise HTTPException(status_code=404, detail=f"Config A not found: {request.config_a_id}")

    config_b = config_store.get_config(request.config_b_id)
    if not config_b:
        raise HTTPException(status_code=404, detail=f"Config B not found: {request.config_b_id}")

    result = await run_ab_test(
        config_a=config_a,
        config_b=config_b,
        test_messages=request.test_messages,
    )
    return result
