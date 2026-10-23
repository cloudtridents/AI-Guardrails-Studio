"""API routes for Red Team testing suite."""

import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services import agent_store, config_store
from app.services.redteam import (
    get_categories,
    get_prompts_for_category,
    run_red_team_suite,
    run_red_team_stream,
    request_cancel,
    list_runs,
    get_run,
    delete_run,
    update_run_triage,
    get_custom_prompts,
    add_custom_prompt,
    edit_custom_prompt,
    delete_custom_prompt,
    create_custom_category,
    export_all_prompts,
    import_prompts,
)

router = APIRouter()


# ─── Request/Response Models ──────────────────────────────────────────────────────


class RedTeamRunRequest(BaseModel):
    agent_id: str
    categories: Optional[list[str]] = None


class AddPromptRequest(BaseModel):
    category: str
    prompt: str


class EditPromptRequest(BaseModel):
    prompt: str


class CreateCategoryRequest(BaseModel):
    name: str
    description: str = ""


class ImportPromptsRequest(BaseModel):
    prompts: dict[str, list[str]]


class TriageUpdateRequest(BaseModel):
    status: str  # "needs_fixing" | "acceptable" | "needs_review"
    severity: str  # "critical" | "high" | "medium" | "low"
    notes: str = ""


class CancelRunRequest(BaseModel):
    run_id: str


# ─── Categories & Prompts ─────────────────────────────────────────────────────────


@router.get("/categories")
async def list_categories():
    """List all red team test categories with prompt counts."""
    return get_categories()


@router.get("/prompts/{category}")
async def get_category_prompts(category: str):
    """Get all test prompts for a specific category."""
    prompts = get_prompts_for_category(category)
    if prompts is None:
        raise HTTPException(status_code=404, detail=f"Category '{category}' not found")
    return {"category": category, "prompts": prompts, "count": len(prompts)}


# ─── Custom Prompts ───────────────────────────────────────────────────────────────


@router.get("/prompts-custom")
async def get_custom_prompts_route():
    """Get all custom prompts."""
    return get_custom_prompts()


@router.post("/prompts")
async def add_prompt(request: AddPromptRequest):
    """Add a custom prompt to a category."""
    result = add_custom_prompt(request.category, request.prompt)
    return {"success": True, "prompts": result}


@router.put("/prompts/{category}/{index}")
async def edit_prompt(category: str, index: int, request: EditPromptRequest):
    """Edit a custom prompt by category and index."""
    success = edit_custom_prompt(category, index, request.prompt)
    if not success:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"success": True}


@router.delete("/prompts/{category}/{index}")
async def delete_prompt(category: str, index: int):
    """Delete a custom prompt by category and index."""
    success = delete_custom_prompt(category, index)
    if not success:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"success": True}


@router.post("/categories")
async def create_category(request: CreateCategoryRequest):
    """Create a new custom category."""
    success = create_custom_category(request.name, request.description)
    if not success:
        raise HTTPException(status_code=400, detail="Category already exists")
    return {"success": True, "name": request.name}


# ─── Import/Export ────────────────────────────────────────────────────────────────


@router.get("/export")
async def export_prompts():
    """Export all prompts (built-in + custom) as JSON."""
    return {"prompts": export_all_prompts()}


@router.post("/import")
async def import_prompts_route(request: ImportPromptsRequest):
    """Import prompts from JSON."""
    count = import_prompts(request.prompts)
    return {"success": True, "imported_count": count}


# ─── Run Execution ────────────────────────────────────────────────────────────────


@router.post("/run")
async def run_red_team(request: RedTeamRunRequest):
    """Run the red team test suite against an agent (non-streaming)."""
    agent = agent_store.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Load guardrail configs
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

    if not input_configs and not output_configs:
        raise HTTPException(
            status_code=400,
            detail="Agent has no guardrails configured. Add guardrails before running red team tests.",
        )

    result = await run_red_team_suite(
        agent_def=agent,
        input_configs=input_configs,
        output_configs=output_configs,
        categories=request.categories,
    )
    return result


@router.post("/run/stream")
async def run_red_team_streaming(request: RedTeamRunRequest):
    """Run the red team test suite with SSE streaming for real-time progress."""
    agent = agent_store.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Load guardrail configs
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

    if not input_configs and not output_configs:
        raise HTTPException(
            status_code=400,
            detail="Agent has no guardrails configured. Add guardrails before running red team tests.",
        )

    generator = run_red_team_stream(
        agent_def=agent,
        input_configs=input_configs,
        output_configs=output_configs,
        categories=request.categories,
    )

    return StreamingResponse(generator, media_type="text/event-stream")


@router.post("/cancel")
async def cancel_run(request: CancelRunRequest):
    """Cancel a running red team test."""
    success = request_cancel(request.run_id)
    if not success:
        raise HTTPException(status_code=404, detail="Run not found or already completed")
    return {"success": True, "run_id": request.run_id}


# ─── Run History ──────────────────────────────────────────────────────────────────


@router.get("/runs")
async def get_runs():
    """List all past runs sorted by timestamp desc."""
    return list_runs()


@router.get("/runs/{run_id}")
async def get_run_details(run_id: str):
    """Get full run details."""
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.delete("/runs/{run_id}")
async def delete_run_route(run_id: str):
    """Delete a run."""
    success = delete_run(run_id)
    if not success:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"success": True}


# ─── Triage ───────────────────────────────────────────────────────────────────────


@router.put("/runs/{run_id}/triage/{test_index}")
async def update_triage(run_id: str, test_index: int, request: TriageUpdateRequest):
    """Update triage data for a failed test."""
    success = update_run_triage(
        run_id,
        test_index,
        {
            "status": request.status,
            "severity": request.severity,
            "notes": request.notes,
        },
    )
    if not success:
        raise HTTPException(status_code=404, detail="Run or test not found")
    return {"success": True}
