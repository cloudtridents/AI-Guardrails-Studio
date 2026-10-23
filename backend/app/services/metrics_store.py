"""Service for tracking guardrail metrics."""

import json
import time
from pathlib import Path
from typing import Optional

METRICS_DIR = Path(__file__).parent.parent.parent / "metrics"


def _ensure_dir():
    METRICS_DIR.mkdir(parents=True, exist_ok=True)


def _metrics_path() -> Path:
    return METRICS_DIR / "events.jsonl"


def record_event(
    agent_id: str,
    config_id: Optional[str],
    stage: str,  # "input" or "output"
    blocked: bool,
    rails_triggered: list[str],
    latency_ms: float,
):
    """Record a guardrail event for metrics."""
    _ensure_dir()
    event = {
        "timestamp": time.time(),
        "agent_id": agent_id,
        "config_id": config_id,
        "stage": stage,
        "blocked": blocked,
        "rails_triggered": rails_triggered,
        "latency_ms": latency_ms,
    }
    with open(_metrics_path(), "a") as f:
        f.write(json.dumps(event) + "\n")


def get_metrics_summary() -> dict:
    """Get aggregated metrics summary."""
    _ensure_dir()
    path = _metrics_path()
    if not path.exists():
        return {
            "total_requests": 0,
            "total_blocked": 0,
            "block_rate": 0,
            "avg_latency_ms": 0,
            "by_agent": {},
            "by_stage": {"input": {"count": 0, "blocked": 0}, "output": {"count": 0, "blocked": 0}},
            "top_rails": {},
            "recent_events": [],
        }

    events = []
    for line in path.read_text().strip().split("\n"):
        if line:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not events:
        return {
            "total_requests": 0,
            "total_blocked": 0,
            "block_rate": 0,
            "avg_latency_ms": 0,
            "by_agent": {},
            "by_stage": {"input": {"count": 0, "blocked": 0}, "output": {"count": 0, "blocked": 0}},
            "top_rails": {},
            "recent_events": [],
        }

    total = len(events)
    blocked = sum(1 for e in events if e["blocked"])
    latencies = [e["latency_ms"] for e in events if e.get("latency_ms")]

    # By agent
    by_agent: dict = {}
    for e in events:
        aid = e["agent_id"]
        if aid not in by_agent:
            by_agent[aid] = {"count": 0, "blocked": 0}
        by_agent[aid]["count"] += 1
        if e["blocked"]:
            by_agent[aid]["blocked"] += 1

    # By stage
    by_stage = {"input": {"count": 0, "blocked": 0}, "output": {"count": 0, "blocked": 0}}
    for e in events:
        stage = e.get("stage", "input")
        if stage in by_stage:
            by_stage[stage]["count"] += 1
            if e["blocked"]:
                by_stage[stage]["blocked"] += 1

    # Top rails triggered
    top_rails: dict = {}
    for e in events:
        for rail in e.get("rails_triggered", []):
            top_rails[rail] = top_rails.get(rail, 0) + 1

    # Sort top rails
    top_rails = dict(sorted(top_rails.items(), key=lambda x: x[1], reverse=True)[:10])

    return {
        "total_requests": total,
        "total_blocked": blocked,
        "block_rate": round(blocked / total * 100, 1) if total > 0 else 0,
        "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0,
        "by_agent": by_agent,
        "by_stage": by_stage,
        "top_rails": top_rails,
        "recent_events": events[-20:][::-1],
    }


def clear_metrics():
    """Clear all metrics data."""
    _ensure_dir()
    path = _metrics_path()
    if path.exists():
        path.unlink()
