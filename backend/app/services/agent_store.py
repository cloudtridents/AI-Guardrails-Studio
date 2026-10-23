"""Service for managing agent definitions on disk."""

import json
import uuid
from pathlib import Path
from typing import Optional

from app.models.schemas import AgentDefinition, AgentSummary

AGENTS_DIR = Path(__file__).parent.parent.parent / "agents"


def _ensure_agents_dir():
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)


def _agent_path(agent_id: str) -> Path:
    return AGENTS_DIR / f"{agent_id}.json"


def list_agents() -> list[AgentSummary]:
    """List all saved agent definitions."""
    _ensure_agents_dir()
    agents = []
    for file in sorted(AGENTS_DIR.glob("*.json")):
        try:
            data = json.loads(file.read_text())
            agents.append(
                AgentSummary(
                    id=data["id"],
                    name=data["name"],
                    description=data.get("description", ""),
                    provider=data.get("provider", "openai"),
                    model=data.get("model", "gpt-5.4-nano"),
                    input_guardrail_id=data.get("input_guardrail_id"),
                    output_guardrail_id=data.get("output_guardrail_id"),
                    input_guardrail_ids=data.get("input_guardrail_ids", []),
                    output_guardrail_ids=data.get("output_guardrail_ids", []),
                    enabled=data.get("enabled", True),
                )
            )
        except (json.JSONDecodeError, KeyError):
            continue
    return agents


def get_agent(agent_id: str) -> Optional[AgentDefinition]:
    """Get an agent definition by ID."""
    path = _agent_path(agent_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        return AgentDefinition(**data)
    except (json.JSONDecodeError, KeyError):
        return None


def save_agent(agent: AgentDefinition) -> AgentDefinition:
    """Save an agent definition. Generates an ID if not present."""
    _ensure_agents_dir()
    if not agent.id:
        agent.id = str(uuid.uuid4())[:8]
    path = _agent_path(agent.id)
    path.write_text(json.dumps(agent.model_dump(), indent=2))
    return agent


def delete_agent(agent_id: str) -> bool:
    """Delete an agent definition by ID."""
    path = _agent_path(agent_id)
    if path.exists():
        path.unlink()
        return True
    return False
