"""Service for running LangChain agents with multi-LLM + chained guardrails (SSE)."""

import json
import logging
import time as _time
from typing import AsyncGenerator, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_core.tools import tool

from app.models.schemas import (
    AgentChatResponse,
    AgentDefinition,
    ChatMessage,
    GuardrailConfig,
    GuardrailResult,
    GuardrailChainResult,
)
from app.services.guardrails_runner import run_input_guardrail, run_output_guardrail

logger = logging.getLogger(__name__)


# ─── Built-in Tools ──────────────────────────────────────────────────────────────


@tool
def search_web(query: str) -> str:
    """Search the web for information. Returns a summary of results."""
    return f"[Search results for '{query}']: This is a placeholder. Connect a real search API for production use."


@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression safely."""
    try:
        allowed_chars = set("0123456789+-*/.() ")
        if not all(c in allowed_chars for c in expression):
            return "Error: Only numeric math expressions are supported."
        result = eval(expression)
        return str(result)
    except Exception as e:
        return f"Error evaluating expression: {e}"


@tool
def get_current_time() -> str:
    """Get the current date and time."""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


AVAILABLE_TOOLS = {
    "search_web": search_web,
    "calculate": calculate,
    "get_current_time": get_current_time,
}


def get_available_tool_names() -> list[str]:
    return list(AVAILABLE_TOOLS.keys())


# ─── Multi-LLM Provider Factory ──────────────────────────────────────────────────

# Supported providers and their models
SUPPORTED_PROVIDERS = {
    "openai": {
        "name": "OpenAI",
        "models": ["gpt-5.4-nano", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "gpt-5.4-nano"],
        "env_key": "OPENAI_API_KEY",
    },
    "azure_openai": {
        "name": "Azure OpenAI",
        "models": ["gpt-5.4-nano", "gpt-4o", "gpt-4-turbo", "gpt-35-turbo"],
        "env_key": "AZURE_OPENAI_API_KEY",
    },
    "anthropic": {
        "name": "Anthropic",
        "models": ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
        "env_key": "ANTHROPIC_API_KEY",
    },
    "bedrock": {
        "name": "AWS Bedrock",
        "models": ["anthropic.claude-3-sonnet", "anthropic.claude-3-haiku", "amazon.titan-text-express"],
        "env_key": "AWS_ACCESS_KEY_ID",
    },
    "ollama": {
        "name": "Ollama (Local)",
        "models": ["llama3", "mistral", "codellama", "phi3"],
        "env_key": None,
    },
}


def get_supported_providers() -> dict:
    """Return supported providers and their models."""
    return SUPPORTED_PROVIDERS


def _create_llm(agent_def: AgentDefinition) -> BaseChatModel:
    """Create the appropriate LLM instance based on provider."""
    provider = agent_def.provider or "openai"
    model = agent_def.model
    temperature = agent_def.temperature

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, temperature=temperature)

    elif provider == "azure_openai":
        from langchain_openai import AzureChatOpenAI
        kwargs = {
            "model": model,
            "temperature": temperature,
        }
        if agent_def.api_base:
            kwargs["azure_endpoint"] = agent_def.api_base
        if agent_def.api_version:
            kwargs["api_version"] = agent_def.api_version
        if agent_def.deployment_name:
            kwargs["deployment_name"] = agent_def.deployment_name
        return AzureChatOpenAI(**kwargs)

    elif provider == "anthropic":
        from langchain_community.chat_models import ChatAnthropic
        return ChatAnthropic(model=model, temperature=temperature)

    elif provider == "bedrock":
        from langchain_community.chat_models import BedrockChat
        kwargs = {"model_id": model, "model_kwargs": {"temperature": temperature}}
        if agent_def.api_base:
            kwargs["region_name"] = agent_def.api_base
        return BedrockChat(**kwargs)

    elif provider == "ollama":
        from langchain_community.chat_models import ChatOllama
        kwargs = {"model": model, "temperature": temperature}
        if agent_def.api_base:
            kwargs["base_url"] = agent_def.api_base
        else:
            kwargs["base_url"] = "http://localhost:11434"
        return ChatOllama(**kwargs)

    else:
        # Fallback to OpenAI
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, temperature=temperature)


# ─── SSE Event Helpers ───────────────────────────────────────────────────────────


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ─── Chained Guardrail Execution ─────────────────────────────────────────────────


async def _run_guardrail_chain(
    configs: list[GuardrailConfig],
    content: str,
    stage: str,  # "input" or "output"
    agent_id: str,
) -> GuardrailChainResult:
    """Run a chain of guardrails in sequence. Short-circuits on first block."""
    from app.services.metrics_store import record_event
    from app.services import audit_log

    results: list[GuardrailResult] = []
    total_latency = 0.0
    effective_content = content

    for config in configs:
        start = _time.time()

        if stage == "input":
            result = await run_input_guardrail(config, effective_content)
        else:
            result = await run_output_guardrail(config, effective_content)

        latency = round((_time.time() - start) * 1000, 1)
        result.config_id = config.id
        result.latency_ms = latency
        total_latency += latency

        # Record metric
        record_event(
            agent_id=agent_id,
            config_id=config.id,
            stage=stage,
            blocked=result.blocked,
            rails_triggered=result.rails_triggered,
            latency_ms=latency,
        )

        # Record audit log entry
        audit_log.record(
            agent_id=agent_id,
            config_id=config.id or "",
            config_name=config.name,
            message=content,
            result="blocked" if result.blocked else "passed",
            latency_ms=latency,
            rails_triggered=result.rails_triggered,
        )

        results.append(result)

        # Short-circuit on block
        if result.blocked:
            return GuardrailChainResult(
                passed=False,
                blocked=True,
                results=results,
                total_latency_ms=total_latency,
            )

        # Pass modified content to next rail in chain
        if result.modified_content:
            effective_content = result.modified_content

    return GuardrailChainResult(
        passed=True,
        blocked=False,
        results=results,
        total_latency_ms=total_latency,
    )


# ─── Streaming Agent Execution ───────────────────────────────────────────────────


async def run_agent_with_guardrails_stream(
    agent_def: AgentDefinition,
    message: str,
    history: list[ChatMessage],
    input_configs: list[GuardrailConfig],
    output_configs: list[GuardrailConfig],
    guardrails_enabled: bool = True,
) -> AsyncGenerator[str, None]:
    """Run the agent pipeline with chained guardrails, yielding SSE events."""

    reasoning: list[str] = []
    input_chain_result: Optional[GuardrailChainResult] = None
    output_chain_result: Optional[GuardrailChainResult] = None
    provider = agent_def.provider or "openai"

    # ── Step 1: Input Guardrail Chain ────────────────────────────────────────
    effective_message = message

    if guardrails_enabled and input_configs:
        rail_count = len(input_configs)
        yield _sse_event("status", {
            "step": 0,
            "label": f"Running {rail_count} input guardrail{'s' if rail_count > 1 else ''}",
        })
        reasoning.append(f"Running {rail_count} input guardrails in chain...")

        input_chain_result = await _run_guardrail_chain(
            input_configs, message, "input", agent_def.id or ""
        )
        reasoning.append(
            f"Input chain: {'BLOCKED' if input_chain_result.blocked else 'PASSED'} "
            f"({input_chain_result.total_latency_ms}ms, {len(input_chain_result.results)} rails)"
        )

        if input_chain_result.blocked:
            blocked_by_id = next(
                (r.config_id for r in input_chain_result.results if r.blocked), "unknown"
            )
            # Resolve config name from the loaded configs
            blocked_by_name = next(
                (c.name for c in input_configs if c.id == blocked_by_id), blocked_by_id
            )
            reasoning.append(f"Blocked by rail: {blocked_by_name}")
            yield _sse_event("status", {"step": 0, "label": f"Input blocked by {blocked_by_name}", "blocked": True})

            final_response = AgentChatResponse(
                response="I'm sorry, I can't process that request. It was blocked by the safety guardrails.",
                input_guardrail=input_chain_result.results[-1] if input_chain_result.results else None,
                input_guardrail_chain=input_chain_result,
                output_guardrail=None,
                output_guardrail_chain=None,
                agent_reasoning=reasoning,
                blocked=True,
                model_used=agent_def.model,
                provider_used=provider,
            )
            yield _sse_event("complete", final_response.model_dump())
            return

        # Use last modified content from chain
        for r in reversed(input_chain_result.results):
            if r.modified_content:
                effective_message = r.modified_content
                reasoning.append("Input transformed by guardrail chain.")
                break

        yield _sse_event("status", {
            "step": 0,
            "label": f"All {rail_count} input rails passed ({input_chain_result.total_latency_ms}ms)",
            "done": True,
        })
    else:
        reasoning.append("Input guardrails: skipped")

    # ── Step 2: Run LangChain Agent ──────────────────────────────────────────
    yield _sse_event("status", {"step": 1, "label": f"Agent thinking ({provider}/{agent_def.model})"})
    reasoning.append(f"Invoking LangChain agent (provider: {provider}, model: {agent_def.model})...")

    try:
        yield _sse_event("status", {"step": 2, "label": "Generating response"})
        agent_response = await _invoke_langchain_agent(agent_def, effective_message, history)
        reasoning.append("Agent responded successfully.")
        yield _sse_event("status", {"step": 2, "label": "Response generated", "done": True})
    except Exception as e:
        logger.exception("Agent execution failed")
        reasoning.append(f"Agent error: {str(e)}")
        yield _sse_event("status", {"step": 2, "label": "Agent error", "error": True})

        final_response = AgentChatResponse(
            response=f"Agent error: {str(e)}",
            input_guardrail=input_chain_result.results[-1] if input_chain_result and input_chain_result.results else None,
            input_guardrail_chain=input_chain_result,
            output_guardrail=None,
            output_guardrail_chain=None,
            agent_reasoning=reasoning,
            blocked=False,
            model_used=agent_def.model,
            provider_used=provider,
        )
        yield _sse_event("complete", final_response.model_dump())
        return

    # ── Step 3: Output Guardrail Chain ───────────────────────────────────────
    final_text = agent_response

    if guardrails_enabled and output_configs:
        rail_count = len(output_configs)
        yield _sse_event("status", {
            "step": 3,
            "label": f"Running {rail_count} output guardrail{'s' if rail_count > 1 else ''}",
        })
        reasoning.append(f"Running {rail_count} output guardrails in chain...")

        output_chain_result = await _run_guardrail_chain(
            output_configs, agent_response, "output", agent_def.id or ""
        )
        reasoning.append(
            f"Output chain: {'BLOCKED' if output_chain_result.blocked else 'PASSED'} "
            f"({output_chain_result.total_latency_ms}ms, {len(output_chain_result.results)} rails)"
        )

        if output_chain_result.blocked:
            blocked_by_id = next(
                (r.config_id for r in output_chain_result.results if r.blocked), "unknown"
            )
            blocked_by_name = next(
                (c.name for c in output_configs if c.id == blocked_by_id), blocked_by_id
            )
            reasoning.append(f"Output blocked by rail: {blocked_by_name}")
            final_text = "I apologize, but I'm unable to provide that response as it didn't pass the safety checks."
            yield _sse_event("status", {"step": 3, "label": f"Output blocked by {blocked_by_name}", "blocked": True})
        else:
            # Use last modified content from chain
            for r in reversed(output_chain_result.results):
                if r.modified_content:
                    final_text = r.modified_content
                    reasoning.append("Response modified by output guardrail chain.")
                    break
            yield _sse_event("status", {
                "step": 3,
                "label": f"All {rail_count} output rails passed ({output_chain_result.total_latency_ms}ms)",
                "done": True,
            })
    else:
        reasoning.append("Output guardrails: skipped")

    # ── Final Response ───────────────────────────────────────────────────────
    final_response = AgentChatResponse(
        response=final_text,
        input_guardrail=input_chain_result.results[-1] if input_chain_result and input_chain_result.results else None,
        input_guardrail_chain=input_chain_result,
        output_guardrail=output_chain_result.results[-1] if output_chain_result and output_chain_result.results else None,
        output_guardrail_chain=output_chain_result,
        agent_reasoning=reasoning,
        blocked=output_chain_result.blocked if output_chain_result else False,
        model_used=agent_def.model,
        provider_used=provider,
    )
    yield _sse_event("complete", final_response.model_dump())


# ─── Non-streaming version ───────────────────────────────────────────────────────


async def run_agent_with_guardrails(
    agent_def: AgentDefinition,
    message: str,
    history: list[ChatMessage],
    input_configs: list[GuardrailConfig],
    output_configs: list[GuardrailConfig],
    guardrails_enabled: bool = True,
) -> AgentChatResponse:
    """Run the full pipeline without streaming."""
    final_response = None
    async for event_str in run_agent_with_guardrails_stream(
        agent_def, message, history, input_configs, output_configs, guardrails_enabled
    ):
        if event_str.startswith("event: complete"):
            data_line = event_str.split("data: ", 1)[1].strip()
            data = json.loads(data_line)
            final_response = AgentChatResponse(**data)

    if final_response is None:
        return AgentChatResponse(
            response="Error: pipeline completed without a response.",
            agent_reasoning=["Pipeline error"],
            blocked=False,
            model_used=agent_def.model,
            provider_used=agent_def.provider or "openai",
        )
    return final_response


# ─── LangChain Agent Invocation ──────────────────────────────────────────────────


async def _invoke_langchain_agent(
    agent_def: AgentDefinition,
    message: str,
    history: list[ChatMessage],
) -> str:
    """Invoke the LangChain agent using the configured provider."""

    llm = _create_llm(agent_def)

    agent_tools = [AVAILABLE_TOOLS[t] for t in agent_def.tools if t in AVAILABLE_TOOLS]
    if agent_tools:
        llm_with_tools = llm.bind_tools(agent_tools)
    else:
        llm_with_tools = llm

    messages = [SystemMessage(content=agent_def.system_prompt)]
    for msg in history:
        if msg.role == "user":
            messages.append(HumanMessage(content=msg.content))
        elif msg.role == "assistant":
            messages.append(AIMessage(content=msg.content))
    messages.append(HumanMessage(content=message))

    response = await llm_with_tools.ainvoke(messages)

    # Handle tool calls if present
    if hasattr(response, "tool_calls") and response.tool_calls:
        tool_results = []
        for tool_call in response.tool_calls:
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]
            if tool_name in AVAILABLE_TOOLS:
                result = AVAILABLE_TOOLS[tool_name].invoke(tool_args)
                tool_results.append(f"[{tool_name}]: {result}")

        if tool_results:
            tool_context = "\n".join(tool_results)
            messages.append(AIMessage(content=response.content or ""))
            messages.append(HumanMessage(
                content=f"Tool results:\n{tool_context}\n\nPlease provide your final answer."
            ))
            # Use base LLM without tools for final answer
            final_llm = _create_llm(agent_def)
            final_response = await final_llm.ainvoke(messages)
            return final_response.content

    return response.content
