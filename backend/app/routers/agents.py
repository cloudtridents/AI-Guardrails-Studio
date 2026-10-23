"""API routes for managing and running LangChain agents."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models.schemas import (
    AgentDefinition,
    AgentSummary,
    AgentChatRequest,
    AgentChatResponse,
)
from app.services import agent_store, config_store
from app.services.agent_runner import (
    run_agent_with_guardrails,
    run_agent_with_guardrails_stream,
    get_available_tool_names,
    get_supported_providers,
)

router = APIRouter()


def _load_configs(config_ids: list[str]):
    """Load guardrail configs by IDs, skipping missing ones."""
    configs = []
    for cid in config_ids:
        c = config_store.get_config(cid)
        if c:
            configs.append(c)
    return configs


@router.get("/tools", response_model=list[str])
async def list_available_tools():
    """List all available tools that can be assigned to agents."""
    return get_available_tool_names()


@router.get("/providers")
async def list_providers():
    """List supported LLM providers and their models."""
    return get_supported_providers()


@router.get("/", response_model=list[AgentSummary])
async def list_agents():
    """List all saved agent definitions."""
    return agent_store.list_agents()


@router.get("/{agent_id}", response_model=AgentDefinition)
async def get_agent(agent_id: str):
    """Get a specific agent definition."""
    agent = agent_store.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.post("/", response_model=AgentDefinition)
async def create_agent(agent: AgentDefinition):
    """Create a new agent definition."""
    agent.id = None
    return agent_store.save_agent(agent)


@router.put("/{agent_id}", response_model=AgentDefinition)
async def update_agent(agent_id: str, agent: AgentDefinition):
    """Update an existing agent definition."""
    existing = agent_store.get_agent(agent_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.id = agent_id
    return agent_store.save_agent(agent)


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str):
    """Delete an agent definition."""
    if not agent_store.delete_agent(agent_id):
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"message": "Agent deleted"}


@router.post("/chat", response_model=AgentChatResponse)
async def chat_with_agent(request: AgentChatRequest):
    """Send a message to an agent (non-streaming)."""
    agent = agent_store.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not agent.enabled:
        raise HTTPException(status_code=400, detail="Agent is disabled")

    input_configs = _load_configs(agent.get_input_guardrail_ids())
    output_configs = _load_configs(agent.get_output_guardrail_ids())

    response = await run_agent_with_guardrails(
        agent_def=agent,
        message=request.message,
        history=request.history,
        input_configs=input_configs,
        output_configs=output_configs,
        guardrails_enabled=request.guardrails_enabled,
    )
    return response


@router.post("/chat/stream")
async def chat_with_agent_stream(request: AgentChatRequest):
    """Send a message to an agent with real-time SSE status updates."""
    agent = agent_store.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not agent.enabled:
        raise HTTPException(status_code=400, detail="Agent is disabled")

    input_configs = _load_configs(agent.get_input_guardrail_ids())
    output_configs = _load_configs(agent.get_output_guardrail_ids())

    async def event_generator():
        async for event in run_agent_with_guardrails_stream(
            agent_def=agent,
            message=request.message,
            history=request.history,
            input_configs=input_configs,
            output_configs=output_configs,
            guardrails_enabled=request.guardrails_enabled,
        ):
            yield event

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
