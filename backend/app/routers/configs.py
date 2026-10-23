"""API routes for managing guardrail configurations."""

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    GuardrailConfig,
    GuardrailConfigSummary,
    ExportResponse,
)
from app.services import config_store
from app.services.version_store import save_version, list_versions, get_version

router = APIRouter()


@router.get("/", response_model=list[GuardrailConfigSummary])
async def list_configurations():
    """List all saved guardrail configurations."""
    return config_store.list_configs()


@router.get("/{config_id}", response_model=GuardrailConfig)
async def get_configuration(config_id: str):
    """Get a specific guardrail configuration."""
    config = config_store.get_config(config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return config


@router.post("/", response_model=GuardrailConfig)
async def create_configuration(config: GuardrailConfig):
    """Create a new guardrail configuration."""
    config.id = None
    saved = config_store.save_config(config)
    # Save initial version
    save_version(saved.id, saved.model_dump(), "Initial version")
    return saved


@router.put("/{config_id}", response_model=GuardrailConfig)
async def update_configuration(config_id: str, config: GuardrailConfig):
    """Update an existing guardrail configuration."""
    existing = config_store.get_config(config_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Configuration not found")
    config.id = config_id
    saved = config_store.save_config(config)
    # Save version snapshot
    save_version(config_id, saved.model_dump(), "Updated")
    return saved


@router.delete("/{config_id}")
async def delete_configuration(config_id: str):
    """Delete a guardrail configuration."""
    if not config_store.delete_config(config_id):
        raise HTTPException(status_code=404, detail="Configuration not found")
    return {"message": "Configuration deleted"}


@router.get("/{config_id}/export", response_model=ExportResponse)
async def export_configuration(config_id: str):
    """Export a configuration as deployment-ready files."""
    config = config_store.get_config(config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return ExportResponse(
        config_yml=config.yaml_content,
        colang_content=config.colang_content,
        prompts_yml=config.prompts_content,
    )


@router.get("/{config_id}/versions")
async def get_config_versions(config_id: str):
    """List all versions of a configuration."""
    config = config_store.get_config(config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return list_versions(config_id)


@router.get("/{config_id}/versions/{version_num}")
async def get_config_version(config_id: str, version_num: int):
    """Get a specific version of a configuration."""
    version = get_version(config_id, version_num)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    return version


@router.post("/{config_id}/versions/{version_num}/restore")
async def restore_config_version(config_id: str, version_num: int):
    """Restore a configuration to a specific version."""
    version = get_version(config_id, version_num)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    config_data = version["data"]
    config = GuardrailConfig(**config_data)
    config.id = config_id
    saved = config_store.save_config(config)
    save_version(config_id, saved.model_dump(), f"Restored from version {version_num}")
    return saved
