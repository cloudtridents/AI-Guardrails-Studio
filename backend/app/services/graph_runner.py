"""LangGraph-based agent runner with guardrail pipeline and visualization."""

import json
import logging
import time as _time
from typing import Annotated, Any, Optional, TypedDict

from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage

from app.models.schemas import (
    AgentChatResponse,
    AgentDefinition,
    ChatMessage,
    GuardrailConfig,
    GuardrailResult,
    GuardrailChainResult,
)
from app.services.guardrails_runner import run_input_guardrail, run_output_guardrail
from app.services.agent_runner import _create_llm, AVAILABLE_TOOLS

logger = logging.getLogger(__name__)


# ─── Graph State Definition ──────────────────────────────────────────────────────


class AgentState(TypedDict):
    """State that flows through the LangGraph pipeline."""
    messages: Annotated[list[BaseMessage], add_messages]
    user_input: str
    effective_input: str
    agent_response: str
    final_response: str
    blocked: bool
    input_chain_result: Optional[dict]
    output_chain_result: Optional[dict]
    reasoning: list[str]
    status_events: list[dict]
    agent_def: dict
    input_configs: list[dict]
    output_configs: list[dict]
    guardrails_enabled: bool


# ─── Graph Node Functions ─────────────────────────────────────────────────────────


async def input_guardrails_node(state: AgentState) -> dict:
    """Run the input guardrail chain."""
    reasoning = list(state.get("reasoning", []))
    status_events = list(state.get("status_events", []))
    input_configs_data = state.get("input_configs", [])
    user_input = state["user_input"]
    guardrails_enabled = state.get("guardrails_enabled", True)

    if not guardrails_enabled or not input_configs_data:
        reasoning.append("Input guardrails: skipped")
        return {
            "effective_input": user_input,
            "blocked": False,
            "input_chain_result": None,
            "reasoning": reasoning,
            "status_events": status_events,
        }

    from app.services.metrics_store import record_event

    configs = [GuardrailConfig(**c) for c in input_configs_data]
    rail_count = len(configs)
    status_events.append({"step": 0, "label": f"Running {rail_count} input guardrails"})
    reasoning.append(f"Running {rail_count} input guardrails in chain...")

    results = []
    total_latency = 0.0
    effective = user_input

    for config in configs:
        start = _time.time()
        result = await run_input_guardrail(config, effective)
        latency = round((_time.time() - start) * 1000, 1)
        result.config_id = config.id
        result.latency_ms = latency
        total_latency += latency

        record_event(
            agent_id=state["agent_def"].get("id", ""),
            config_id=config.id,
            stage="input",
            blocked=result.blocked,
            rails_triggered=result.rails_triggered,
            latency_ms=latency,
        )

        results.append(result.model_dump())

        if result.blocked:
            reasoning.append(f"Blocked by input rail: {config.name} ({latency}ms)")
            status_events.append({"step": 0, "label": f"Blocked by {config.name}", "blocked": True})
            chain_result = {"passed": False, "blocked": True, "results": results, "total_latency_ms": total_latency}
            return {
                "effective_input": effective,
                "blocked": True,
                "input_chain_result": chain_result,
                "reasoning": reasoning,
                "status_events": status_events,
            }

        if result.modified_content:
            effective = result.modified_content

    reasoning.append(f"All {rail_count} input rails passed ({total_latency}ms)")
    status_events.append({"step": 0, "label": f"Input rails passed ({total_latency}ms)", "done": True})
    chain_result = {"passed": True, "blocked": False, "results": results, "total_latency_ms": total_latency}

    return {
        "effective_input": effective,
        "blocked": False,
        "input_chain_result": chain_result,
        "reasoning": reasoning,
        "status_events": status_events,
    }


async def agent_node(state: AgentState) -> dict:
    """Run the LangChain LLM agent."""
    reasoning = list(state.get("reasoning", []))
    status_events = list(state.get("status_events", []))
    agent_def_data = state["agent_def"]
    agent_def = AgentDefinition(**agent_def_data)
    effective_input = state["effective_input"]
    messages = state.get("messages", [])

    status_events.append({"step": 1, "label": f"Agent thinking ({agent_def.provider}/{agent_def.model})"})
    reasoning.append(f"Invoking agent (provider: {agent_def.provider}, model: {agent_def.model})...")

    try:
        llm = _create_llm(agent_def)
        agent_tools = [AVAILABLE_TOOLS[t] for t in agent_def.tools if t in AVAILABLE_TOOLS]
        if agent_tools:
            llm_with_tools = llm.bind_tools(agent_tools)
        else:
            llm_with_tools = llm

        # Build message list
        msgs: list[BaseMessage] = [SystemMessage(content=agent_def.system_prompt)]
        for m in messages:
            if isinstance(m, BaseMessage):
                msgs.append(m)
        msgs.append(HumanMessage(content=effective_input))

        status_events.append({"step": 2, "label": "Generating response"})
        response = await llm_with_tools.ainvoke(msgs)

        # Handle tool calls
        if hasattr(response, "tool_calls") and response.tool_calls:
            tool_results = []
            for tool_call in response.tool_calls:
                tool_name = tool_call["name"]
                tool_args = tool_call["args"]
                if tool_name in AVAILABLE_TOOLS:
                    result = AVAILABLE_TOOLS[tool_name].invoke(tool_args)
                    tool_results.append(f"[{tool_name}]: {result}")
                    reasoning.append(f"Tool called: {tool_name}")

            if tool_results:
                tool_context = "\n".join(tool_results)
                msgs.append(AIMessage(content=response.content or ""))
                msgs.append(HumanMessage(content=f"Tool results:\n{tool_context}\n\nProvide your final answer."))
                final_llm = _create_llm(agent_def)
                final_response = await final_llm.ainvoke(msgs)
                agent_response = final_response.content
            else:
                agent_response = response.content
        else:
            agent_response = response.content

        reasoning.append("Agent responded successfully.")
        status_events.append({"step": 2, "label": "Response generated", "done": True})

        return {
            "agent_response": agent_response,
            "reasoning": reasoning,
            "status_events": status_events,
        }

    except Exception as e:
        logger.exception("Agent execution failed")
        reasoning.append(f"Agent error: {str(e)}")
        status_events.append({"step": 2, "label": "Agent error", "error": True})
        return {
            "agent_response": f"Agent error: {str(e)}",
            "reasoning": reasoning,
            "status_events": status_events,
        }


async def output_guardrails_node(state: AgentState) -> dict:
    """Run the output guardrail chain."""
    reasoning = list(state.get("reasoning", []))
    status_events = list(state.get("status_events", []))
    output_configs_data = state.get("output_configs", [])
    agent_response = state["agent_response"]
    guardrails_enabled = state.get("guardrails_enabled", True)

    if not guardrails_enabled or not output_configs_data:
        reasoning.append("Output guardrails: skipped")
        return {
            "final_response": agent_response,
            "blocked": False,
            "output_chain_result": None,
            "reasoning": reasoning,
            "status_events": status_events,
        }

    from app.services.metrics_store import record_event

    configs = [GuardrailConfig(**c) for c in output_configs_data]
    rail_count = len(configs)
    status_events.append({"step": 3, "label": f"Running {rail_count} output guardrails"})
    reasoning.append(f"Running {rail_count} output guardrails...")

    results = []
    total_latency = 0.0
    effective = agent_response

    for config in configs:
        start = _time.time()
        result = await run_output_guardrail(config, effective)
        latency = round((_time.time() - start) * 1000, 1)
        result.config_id = config.id
        result.latency_ms = latency
        total_latency += latency

        record_event(
            agent_id=state["agent_def"].get("id", ""),
            config_id=config.id,
            stage="output",
            blocked=result.blocked,
            rails_triggered=result.rails_triggered,
            latency_ms=latency,
        )

        results.append(result.model_dump())

        if result.blocked:
            reasoning.append(f"Output blocked by: {config.name} ({latency}ms)")
            status_events.append({"step": 3, "label": f"Output blocked by {config.name}", "blocked": True})
            chain_result = {"passed": False, "blocked": True, "results": results, "total_latency_ms": total_latency}
            return {
                "final_response": "I apologize, but I'm unable to provide that response as it didn't pass the safety checks.",
                "blocked": True,
                "output_chain_result": chain_result,
                "reasoning": reasoning,
                "status_events": status_events,
            }

        if result.modified_content:
            effective = result.modified_content

    reasoning.append(f"All {rail_count} output rails passed ({total_latency}ms)")
    status_events.append({"step": 3, "label": f"Output rails passed ({total_latency}ms)", "done": True})
    chain_result = {"passed": True, "blocked": False, "results": results, "total_latency_ms": total_latency}

    return {
        "final_response": effective,
        "blocked": False,
        "output_chain_result": chain_result,
        "reasoning": reasoning,
        "status_events": status_events,
    }


# ─── Conditional Edges ────────────────────────────────────────────────────────────


def should_continue_after_input(state: AgentState) -> str:
    """Route after input guardrails: blocked → end, passed → agent."""
    if state.get("blocked", False):
        return "blocked"
    return "agent"


def should_continue_after_output(state: AgentState) -> str:
    """Route after output guardrails (for future extensions)."""
    return "end"


# ─── Build the Graph ──────────────────────────────────────────────────────────────


def build_guardrails_graph() -> StateGraph:
    """Build the LangGraph for the guardrails agent pipeline."""
    graph = StateGraph(AgentState)

    # Add nodes
    graph.add_node("input_guardrails", input_guardrails_node)
    graph.add_node("agent", agent_node)
    graph.add_node("output_guardrails", output_guardrails_node)

    # Add edges
    graph.set_entry_point("input_guardrails")
    graph.add_conditional_edges(
        "input_guardrails",
        should_continue_after_input,
        {"blocked": END, "agent": "agent"},
    )
    graph.add_edge("agent", "output_guardrails")
    graph.add_edge("output_guardrails", END)

    return graph


def get_graph_visualization() -> str:
    """Get Mermaid diagram of the agent pipeline graph."""
    graph = build_guardrails_graph()
    compiled = graph.compile()
    try:
        return compiled.get_graph().draw_mermaid()
    except Exception:
        # Fallback manual mermaid if the method isn't available
        return """graph TD
    __start__([Start]) --> input_guardrails[🛡️ Input Guardrails Chain]
    input_guardrails -->|blocked| __end__([End - Blocked])
    input_guardrails -->|passed| agent[🧠 LangChain Agent]
    agent --> output_guardrails[🔍 Output Guardrails Chain]
    output_guardrails --> __end2__([End - Response])

    style input_guardrails fill:#f59e0b22,stroke:#f59e0b
    style agent fill:#76b90022,stroke:#76b900
    style output_guardrails fill:#60a5fa22,stroke:#60a5fa
"""


async def run_graph_agent(
    agent_def: AgentDefinition,
    message: str,
    history: list[ChatMessage],
    input_configs: list[GuardrailConfig],
    output_configs: list[GuardrailConfig],
    guardrails_enabled: bool = True,
) -> AgentChatResponse:
    """Run the agent through the LangGraph pipeline."""

    graph = build_guardrails_graph()
    compiled = graph.compile()

    # Build initial messages from history
    messages: list[BaseMessage] = []
    for msg in history:
        if msg.role == "user":
            messages.append(HumanMessage(content=msg.content))
        elif msg.role == "assistant":
            messages.append(AIMessage(content=msg.content))

    # Build initial state
    initial_state: AgentState = {
        "messages": messages,
        "user_input": message,
        "effective_input": message,
        "agent_response": "",
        "final_response": "",
        "blocked": False,
        "input_chain_result": None,
        "output_chain_result": None,
        "reasoning": [],
        "status_events": [],
        "agent_def": agent_def.model_dump(),
        "input_configs": [c.model_dump() for c in input_configs],
        "output_configs": [c.model_dump() for c in output_configs],
        "guardrails_enabled": guardrails_enabled,
    }

    # Run the graph
    final_state = await compiled.ainvoke(initial_state)

    # Build response
    provider = agent_def.provider or "openai"
    input_chain = None
    output_chain = None

    if final_state.get("input_chain_result"):
        input_chain = GuardrailChainResult(**final_state["input_chain_result"])
    if final_state.get("output_chain_result"):
        output_chain = GuardrailChainResult(**final_state["output_chain_result"])

    # Get response text
    response_text = final_state.get("final_response") or final_state.get("agent_response", "")
    if final_state.get("blocked") and not final_state.get("final_response"):
        response_text = "I'm sorry, I can't process that request. It was blocked by the safety guardrails."

    return AgentChatResponse(
        response=response_text,
        input_guardrail=None,
        input_guardrail_chain=input_chain,
        output_guardrail=None,
        output_guardrail_chain=output_chain,
        agent_reasoning=final_state.get("reasoning", []),
        blocked=final_state.get("blocked", False),
        model_used=agent_def.model,
        provider_used=provider,
    )
