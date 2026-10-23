"""API routes for local classifier configuration and testing.

Supports two decision backends and a combination of both:
  - bert     : local DistilBERT zero-shot classifier (default)
  - strands  : strands-decider decision model (served over HTTP)
  - combined : run both; a category triggers if either backend crosses its
               threshold (the max score is used)
"""

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.local_classifier import (
    classify_text,
    get_categories,
    add_custom_category,
    remove_custom_category,
    get_model_info,
    get_decision_backend,
)
from app.services import strands_decider

router = APIRouter()

VALID_BACKENDS = ("bert", "strands", "combined")


class ClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1)
    categories: dict | None = None  # Optional override
    backend: str | None = Field(
        default=None,
        description="Decision backend override: bert | strands | combined",
    )


class BackendRequest(BaseModel):
    backend: str = Field(..., description="Decision backend: bert | strands | combined")


class CategoryConfig(BaseModel):
    labels: list[str] = Field(..., min_items=1)
    threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    action: str = Field(default="block", pattern="^(block|flag|escalate)$")
    description: str = ""


class BatchClassifyRequest(BaseModel):
    texts: list[str] = Field(..., min_items=1)
    backend: str | None = Field(
        default=None,
        description="Decision backend override: bert | strands | combined",
    )


@router.get("/model")
async def model_info():
    """Get information about the loaded classifier model(s) and active backend."""
    return get_model_info()


@router.get("/backend")
async def get_backend():
    """Get the active decision backend and strands-decider availability."""
    backend = get_decision_backend()
    return {
        "backend": backend,
        "available_backends": list(VALID_BACKENDS),
        "strands": strands_decider.health(),
    }


@router.put("/backend")
async def set_backend(req: BackendRequest):
    """Switch the active decision backend (bert | strands | combined).

    Updates the process environment so the change takes effect immediately
    without a restart. Set DECISION_BACKEND in the environment to persist it
    across restarts.
    """
    backend = req.backend.strip().lower()
    if backend not in VALID_BACKENDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid backend '{backend}'. Must be one of: {', '.join(VALID_BACKENDS)}",
        )
    os.environ["DECISION_BACKEND"] = backend
    result = {"backend": backend, "message": f"Decision backend set to '{backend}'"}
    if backend in ("strands", "combined"):
        result["strands"] = strands_decider.health()
    return result


@router.get("/categories")
async def list_categories():
    """List all configured classification categories."""
    return get_categories()


@router.post("/categories/{name}")
async def create_category(name: str, config: CategoryConfig):
    """Add or update a custom classification category."""
    add_custom_category(name, config.model_dump())
    return {"message": f"Category '{name}' saved", "category": config.model_dump()}


@router.delete("/categories/{name}")
async def delete_category(name: str):
    """Remove a custom classification category."""
    if not remove_custom_category(name):
        raise HTTPException(status_code=404, detail="Category not found or is a default")
    return {"message": f"Category '{name}' removed"}


@router.post("/classify")
async def classify(request: ClassifyRequest):
    """Classify a single text against all configured categories."""
    if request.backend is not None and request.backend.lower() not in VALID_BACKENDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid backend '{request.backend}'. Must be one of: {', '.join(VALID_BACKENDS)}",
        )
    try:
        return classify_text(request.text, request.categories, backend=request.backend)
    except strands_decider.StrandsDeciderError as e:
        raise HTTPException(
            status_code=503,
            detail=f"strands-decider backend unavailable: {e}",
        )


@router.post("/batch")
async def batch_classify(request: BatchClassifyRequest):
    """Classify multiple texts and return aggregate results."""
    if request.backend is not None and request.backend.lower() not in VALID_BACKENDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid backend '{request.backend}'. Must be one of: {', '.join(VALID_BACKENDS)}",
        )

    results = []
    total_blocked = 0
    total_flagged = 0
    total_latency = 0.0

    try:
        for text in request.texts:
            r = classify_text(text, backend=request.backend)
            results.append(r)
    except strands_decider.StrandsDeciderError as e:
        raise HTTPException(
            status_code=503,
            detail=f"strands-decider backend unavailable: {e}",
        )

    for r in results:
        if r["blocked"]:
            total_blocked += 1
        if r["flagged"]:
            total_flagged += 1
        total_latency += r["latency_ms"]

    return {
        "total": len(request.texts),
        "blocked": total_blocked,
        "flagged": total_flagged,
        "block_rate": round(total_blocked / len(request.texts) * 100, 1) if request.texts else 0,
        "total_latency_ms": round(total_latency, 1),
        "avg_latency_ms": round(total_latency / len(request.texts), 1) if request.texts else 0,
        "results": results,
    }
