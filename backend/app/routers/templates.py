"""API routes for guardrail configuration templates."""

from fastapi import APIRouter, HTTPException

from app.services.templates import list_templates, get_template
from app.services import config_store
from app.models.schemas import GuardrailConfig

router = APIRouter()


@router.get("/")
async def get_templates():
    """List all available templates."""
    return list_templates()


@router.get("/{template_id}")
async def get_template_detail(template_id: str):
    """Get a full template by ID."""
    tpl = get_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl


@router.post("/{template_id}/apply")
async def apply_template(template_id: str):
    """Create a new configuration from a template."""
    tpl = get_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")

    config = GuardrailConfig(
        name=tpl["name"],
        description=tpl["description"],
        colang_content=tpl.get("colang_content", ""),
        yaml_content=tpl.get("yaml_content", ""),
        prompts_content=tpl.get("prompts_content", ""),
    )
    saved = config_store.save_config(config)
    return saved
