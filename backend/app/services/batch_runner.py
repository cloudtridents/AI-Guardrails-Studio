"""Service for batch testing guardrails with multiple messages."""

import asyncio
import time
from typing import Optional

from app.models.schemas import AgentDefinition, GuardrailConfig, ChatMessage
from app.services.agent_runner import run_agent_with_guardrails


async def run_batch_test(
    agent_def: AgentDefinition,
    messages: list[str],
    input_configs: list[GuardrailConfig],
    output_configs: list[GuardrailConfig],
) -> dict:
    """Run a batch of messages through the agent pipeline and return results."""
    results = []
    total_blocked = 0
    total_passed = 0
    start_time = time.time()

    for i, message in enumerate(messages):
        msg_start = time.time()

        response = await run_agent_with_guardrails(
            agent_def=agent_def,
            message=message,
            history=[],
            input_configs=input_configs,
            output_configs=output_configs,
            guardrails_enabled=True,
        )

        msg_latency = round((time.time() - msg_start) * 1000, 1)

        blocked = response.blocked
        if blocked:
            total_blocked += 1
        else:
            total_passed += 1

        results.append({
            "index": i,
            "input": message,
            "output": response.response,
            "blocked": blocked,
            "input_rail_triggered": (
                response.input_guardrail.rails_triggered if response.input_guardrail else []
            ),
            "output_rail_triggered": (
                response.output_guardrail.rails_triggered if response.output_guardrail else []
            ),
            "latency_ms": msg_latency,
        })

    total_time = round((time.time() - start_time) * 1000, 1)

    return {
        "total_messages": len(messages),
        "total_blocked": total_blocked,
        "total_passed": total_passed,
        "block_rate": round(total_blocked / len(messages) * 100, 1) if messages else 0,
        "total_time_ms": total_time,
        "avg_latency_ms": round(total_time / len(messages), 1) if messages else 0,
        "results": results,
    }
