"""Audit Log service - Store and query guardrail evaluation records."""

import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

AUDIT_DIR = Path(__file__).parent.parent.parent / "audit"
AUDIT_FILE = AUDIT_DIR / "audit.jsonl"


def _ensure_audit_dir():
    """Ensure the audit directory exists."""
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)


def record(
    agent_id: str,
    config_id: str,
    config_name: str,
    message: str,
    result: str,
    latency_ms: float,
    rails_triggered: Optional[list[str]] = None,
):
    """Record a guardrail evaluation in the audit log."""
    _ensure_audit_dir()

    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "agent_id": agent_id,
        "config_id": config_id,
        "config_name": config_name,
        "message": message[:200],  # Truncate long messages
        "result": result,  # "blocked" or "passed"
        "latency_ms": round(latency_ms, 1),
        "rails_triggered": rails_triggered or [],
    }

    try:
        with open(AUDIT_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        logger.error(f"Failed to write audit log: {e}")


def query(
    agent_id: Optional[str] = None,
    result: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """Query audit log entries with optional filters."""
    _ensure_audit_dir()

    if not AUDIT_FILE.exists():
        return {"entries": [], "total": 0, "limit": limit, "offset": offset}

    entries = []
    try:
        with open(AUDIT_FILE, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    entries.append(entry)
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.error(f"Failed to read audit log: {e}")
        return {"entries": [], "total": 0, "limit": limit, "offset": offset}

    # Apply filters
    filtered = entries

    if agent_id:
        filtered = [e for e in filtered if e.get("agent_id") == agent_id]

    if result:
        filtered = [e for e in filtered if e.get("result") == result]

    if start_date:
        filtered = [e for e in filtered if e.get("timestamp", "") >= start_date]

    if end_date:
        filtered = [e for e in filtered if e.get("timestamp", "") <= end_date]

    # Sort by timestamp descending (most recent first)
    filtered.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    total = len(filtered)
    paginated = filtered[offset : offset + limit]

    return {"entries": paginated, "total": total, "limit": limit, "offset": offset}


def get_summary(agent_id: Optional[str] = None) -> dict:
    """Generate a compliance summary of all audit entries."""
    _ensure_audit_dir()

    if not AUDIT_FILE.exists():
        return {
            "total_evaluations": 0,
            "total_blocked": 0,
            "total_passed": 0,
            "block_rate": 0,
            "avg_latency_ms": 0,
            "compliance_score": 100,
            "by_agent": {},
            "by_config": {},
        }

    entries = []
    try:
        with open(AUDIT_FILE, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    entries.append(entry)
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.error(f"Failed to read audit log: {e}")
        return {"total_evaluations": 0, "total_blocked": 0, "total_passed": 0,
                "block_rate": 0, "avg_latency_ms": 0, "compliance_score": 100,
                "by_agent": {}, "by_config": {}}

    if agent_id:
        entries = [e for e in entries if e.get("agent_id") == agent_id]

    total = len(entries)
    if total == 0:
        return {
            "total_evaluations": 0,
            "total_blocked": 0,
            "total_passed": 0,
            "block_rate": 0,
            "avg_latency_ms": 0,
            "compliance_score": 100,
            "by_agent": {},
            "by_config": {},
        }

    blocked = sum(1 for e in entries if e.get("result") == "blocked")
    passed = total - blocked
    latencies = [e.get("latency_ms", 0) for e in entries]
    avg_latency = round(sum(latencies) / len(latencies), 1) if latencies else 0

    # Compliance score: higher is better, based on block rate of adversarial content
    # This is a simplified metric
    block_rate = round(blocked / total * 100, 1)
    compliance_score = round(min(100, block_rate + 50), 1)  # Simplified scoring

    # Group by agent
    by_agent: dict = {}
    for e in entries:
        aid = e.get("agent_id", "unknown")
        if aid not in by_agent:
            by_agent[aid] = {"total": 0, "blocked": 0, "passed": 0}
        by_agent[aid]["total"] += 1
        if e.get("result") == "blocked":
            by_agent[aid]["blocked"] += 1
        else:
            by_agent[aid]["passed"] += 1

    # Group by config
    by_config: dict = {}
    for e in entries:
        cname = e.get("config_name", "unknown")
        if cname not in by_config:
            by_config[cname] = {"total": 0, "blocked": 0, "passed": 0}
        by_config[cname]["total"] += 1
        if e.get("result") == "blocked":
            by_config[cname]["blocked"] += 1
        else:
            by_config[cname]["passed"] += 1

    return {
        "total_evaluations": total,
        "total_blocked": blocked,
        "total_passed": passed,
        "block_rate": block_rate,
        "avg_latency_ms": avg_latency,
        "compliance_score": compliance_score,
        "by_agent": by_agent,
        "by_config": by_config,
    }


def export_csv() -> str:
    """Export all audit entries as CSV format."""
    _ensure_audit_dir()

    headers = ["timestamp", "agent_id", "config_id", "config_name", "message", "result", "latency_ms", "rails_triggered"]
    lines = [",".join(headers)]

    if not AUDIT_FILE.exists():
        return "\n".join(lines)

    try:
        with open(AUDIT_FILE, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    row = [
                        entry.get("timestamp", ""),
                        entry.get("agent_id", ""),
                        entry.get("config_id", ""),
                        entry.get("config_name", ""),
                        '"' + entry.get("message", "").replace('"', '""') + '"',
                        entry.get("result", ""),
                        str(entry.get("latency_ms", 0)),
                        '"' + ";".join(entry.get("rails_triggered", [])) + '"',
                    ]
                    lines.append(",".join(row))
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.error(f"Failed to read audit log for export: {e}")

    return "\n".join(lines)


def clear():
    """Clear all audit log entries."""
    _ensure_audit_dir()
    try:
        if AUDIT_FILE.exists():
            AUDIT_FILE.unlink()
        # Create empty file
        AUDIT_FILE.touch()
        return True
    except Exception as e:
        logger.error(f"Failed to clear audit log: {e}")
        return False
