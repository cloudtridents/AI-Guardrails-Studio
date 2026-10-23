"""Service for managing guardrail configurations on disk."""

import json
import os
import uuid
from pathlib import Path
from typing import Optional

from app.models.schemas import GuardrailConfig, GuardrailConfigSummary

CONFIGS_DIR = Path(__file__).parent.parent.parent / "configs"


def _ensure_configs_dir():
    CONFIGS_DIR.mkdir(parents=True, exist_ok=True)


def _config_path(config_id: str) -> Path:
    return CONFIGS_DIR / f"{config_id}.json"


def list_configs() -> list[GuardrailConfigSummary]:
    """List all saved configurations."""
    _ensure_configs_dir()
    configs = []
    for file in sorted(CONFIGS_DIR.glob("*.json")):
        try:
            data = json.loads(file.read_text())
            configs.append(
                GuardrailConfigSummary(
                    id=data["id"],
                    name=data["name"],
                    description=data.get("description", ""),
                )
            )
        except (json.JSONDecodeError, KeyError):
            continue
    return configs


def get_config(config_id: str) -> Optional[GuardrailConfig]:
    """Get a configuration by ID."""
    path = _config_path(config_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        return GuardrailConfig(**data)
    except (json.JSONDecodeError, KeyError):
        return None


def save_config(config: GuardrailConfig) -> GuardrailConfig:
    """Save a configuration. Generates an ID if not present."""
    _ensure_configs_dir()
    if not config.id:
        config.id = str(uuid.uuid4())[:8]
    path = _config_path(config.id)
    path.write_text(json.dumps(config.model_dump(), indent=2))
    
    # Invalidate guardrails cache for this config
    try:
        from app.services.guardrails_runner import _invalidate_cache
        _invalidate_cache(config.id)
    except ImportError:
        pass
    
    return config


def delete_config(config_id: str) -> bool:
    """Delete a configuration by ID."""
    path = _config_path(config_id)
    if path.exists():
        path.unlink()
        
        # Invalidate guardrails cache
        try:
            from app.services.guardrails_runner import _invalidate_cache
            _invalidate_cache(config_id)
        except ImportError:
            pass
        
        return True
    return False
