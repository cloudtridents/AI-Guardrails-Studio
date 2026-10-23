"""API routes for LangGraph visualization and execution."""

from fastapi import APIRouter, HTTPException

from app.models.schemas import AgentChatRequest, AgentChatResponse
from app.services import agent_store, config_store
from app.services.graph_runner import get_graph_visualization, run_graph_agent

router = APIRouter()


@router.get("/visualization")
async def get_graph_visual():
    """Get the Mermaid diagram of the guardrails agent pipeline."""
    mermaid = get_graph_visualization()
    return {"mermaid": mermaid}


@router.get("/visualization/{agent_id}")
async def get_agent_graph_visual(agent_id: str):
    """Get a customized Mermaid diagram for a specific agent."""
    agent = agent_store.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    input_ids = agent.get_input_guardrail_ids()
    output_ids = agent.get_output_guardrail_ids()

    # Build a customized mermaid showing the actual config names
    input_labels = []
    for cid in input_ids:
        c = config_store.get_config(cid)
        input_labels.append(c.name if c else cid)

    output_labels = []
    for cid in output_ids:
        c = config_store.get_config(cid)
        output_labels.append(c.name if c else cid)

    # Build custom mermaid
    lines = ["graph TD"]
    lines.append("    START([🚀 User Message]) --> input_check{Input Guardrails?}")

    if input_labels:
        prev = "input_check"
        for i, label in enumerate(input_labels):
            node_id = f"input_rail_{i}"
            lines.append(f"    {prev} -->|pass| {node_id}[🛡️ {label}]")
            lines.append(f"    {node_id} -->|blocked| BLOCKED([❌ Blocked])")
            prev = node_id
        lines.append(f"    {prev} -->|pass| agent[🧠 {agent.name}]")
    else:
        lines.append("    input_check -->|no rails| agent[🧠 " + agent.name + "]")

    lines.append(f"    agent --> |response| output_check{{Output Guardrails?}}")

    if output_labels:
        prev = "output_check"
        for i, label in enumerate(output_labels):
            node_id = f"output_rail_{i}"
            lines.append(f"    {prev} -->|pass| {node_id}[🔍 {label}]")
            lines.append(f"    {node_id} -->|blocked| SAFE_RESP([⚠️ Safe Response])")
            prev = node_id
        lines.append(f"    {prev} -->|pass| DONE([✅ Response to User])")
    else:
        lines.append("    output_check -->|no rails| DONE([✅ Response to User])")

    # Styling
    lines.append("")
    lines.append("    style agent fill:#76b90022,stroke:#76b900,stroke-width:2px")
    lines.append("    style BLOCKED fill:#ef444422,stroke:#ef4444")
    lines.append("    style DONE fill:#10b98122,stroke:#10b981")
    if input_labels:
        for i in range(len(input_labels)):
            lines.append(f"    style input_rail_{i} fill:#f59e0b22,stroke:#f59e0b")
    if output_labels:
        for i in range(len(output_labels)):
            lines.append(f"    style output_rail_{i} fill:#60a5fa22,stroke:#60a5fa")

    mermaid = "\n".join(lines)

    return {
        "mermaid": mermaid,
        "agent_name": agent.name,
        "provider": agent.provider or "openai",
        "model": agent.model,
        "input_rails": input_labels,
        "output_rails": output_labels,
    }


@router.post("/run", response_model=AgentChatResponse)
async def run_via_graph(request: AgentChatRequest):
    """Run an agent through the LangGraph pipeline."""
    agent = agent_store.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not agent.enabled:
        raise HTTPException(status_code=400, detail="Agent is disabled")

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

    response = await run_graph_agent(
        agent_def=agent,
        message=request.message,
        history=request.history,
        input_configs=input_configs,
        output_configs=output_configs,
        guardrails_enabled=request.guardrails_enabled,
    )
    return response
