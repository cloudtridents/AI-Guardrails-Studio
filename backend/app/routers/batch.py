"""API routes for batch testing."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import agent_store, config_store
from app.services.batch_runner import run_batch_test

router = APIRouter()


class BatchTestRequest(BaseModel):
    agent_id: str
    messages: list[str]


@router.post("/")
async def run_batch(request: BatchTestRequest):
    """Run a batch of test messages through an agent's guardrail pipeline."""
    agent = agent_store.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not request.messages:
        raise HTTPException(status_code=400, detail="No messages provided")

    # Load guardrail config chains
    input_configs = []
    for cid in agent.get_input_guardrail_ids():
        c = config_store.get_config(cid)
        if c:
            input_configs.append(c)

    output_configs = []
    for cid in agent.get_output_guardrail_ids():
        c = config_store.get_config(cid)
        if c:
            output_configs.append(c)

    result = await run_batch_test(
        agent_def=agent,
        messages=request.messages,
        input_configs=input_configs,
        output_configs=output_configs,
    )
    return result
