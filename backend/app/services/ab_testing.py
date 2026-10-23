"""A/B Testing service - Compare two guardrail configurations side by side."""

import logging
import time
from typing import Optional

from app.models.schemas import AgentDefinition, GuardrailConfig
from app.services.guardrails_runner import run_input_guardrail

logger = logging.getLogger(__name__)


async def run_ab_test(
    config_a: GuardrailConfig,
    config_b: GuardrailConfig,
    test_messages: list[str],
) -> dict:
    """Compare two guardrail configs against the same test corpus."""
    results = []
    a_blocked = 0
    b_blocked = 0
    a_total_latency = 0.0
    b_total_latency = 0.0
    agreements = 0
    start_time = time.time()

    for i, message in enumerate(test_messages):
        # Run config A
        a_start = time.time()
        try:
            result_a = await run_input_guardrail(config_a, message)
            a_latency = round((time.time() - a_start) * 1000, 1)
            a_was_blocked = result_a.blocked
        except Exception as e:
            logger.exception(f"Config A error on message {i}")
            a_latency = round((time.time() - a_start) * 1000, 1)
            a_was_blocked = False

        # Run config B
        b_start = time.time()
        try:
            result_b = await run_input_guardrail(config_b, message)
            b_latency = round((time.time() - b_start) * 1000, 1)
            b_was_blocked = result_b.blocked
        except Exception as e:
            logger.exception(f"Config B error on message {i}")
            b_latency = round((time.time() - b_start) * 1000, 1)
            b_was_blocked = False

        if a_was_blocked:
            a_blocked += 1
        if b_was_blocked:
            b_blocked += 1
        if a_was_blocked == b_was_blocked:
            agreements += 1

        a_total_latency += a_latency
        b_total_latency += b_latency

        results.append({
            "index": i,
            "message": message,
            "config_a_blocked": a_was_blocked,
            "config_b_blocked": b_was_blocked,
            "config_a_latency_ms": a_latency,
            "config_b_latency_ms": b_latency,
            "agreement": a_was_blocked == b_was_blocked,
        })

    total_messages = len(test_messages)
    total_time_ms = round((time.time() - start_time) * 1000, 1)

    # Determine which is stricter
    if a_blocked > b_blocked:
        stricter = "config_a"
    elif b_blocked > a_blocked:
        stricter = "config_b"
    else:
        stricter = "equal"

    # Determine which is faster
    if a_total_latency < b_total_latency:
        faster = "config_a"
    elif b_total_latency < a_total_latency:
        faster = "config_b"
    else:
        faster = "equal"

    return {
        "total_messages": total_messages,
        "total_time_ms": total_time_ms,
        "config_a": {
            "id": config_a.id,
            "name": config_a.name,
            "blocked": a_blocked,
            "passed": total_messages - a_blocked,
            "block_rate": round(a_blocked / total_messages * 100, 1) if total_messages else 0,
            "avg_latency_ms": round(a_total_latency / total_messages, 1) if total_messages else 0,
            "total_latency_ms": round(a_total_latency, 1),
        },
        "config_b": {
            "id": config_b.id,
            "name": config_b.name,
            "blocked": b_blocked,
            "passed": total_messages - b_blocked,
            "block_rate": round(b_blocked / total_messages * 100, 1) if total_messages else 0,
            "avg_latency_ms": round(b_total_latency / total_messages, 1) if total_messages else 0,
            "total_latency_ms": round(b_total_latency, 1),
        },
        "agreement_rate": round(agreements / total_messages * 100, 1) if total_messages else 0,
        "stricter": stricter,
        "faster": faster,
        "results": results,
    }
