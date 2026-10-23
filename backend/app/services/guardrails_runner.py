"""Service for running NeMo Guardrails against user messages."""

import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from nemoguardrails import RailsConfig, LLMRails

from app.models.schemas import ChatMessage, ChatResponse, GuardrailConfig, GuardrailResult

# Ensure .env is loaded (for OPENAI_API_KEY and other credentials)
load_dotenv()

logger = logging.getLogger(__name__)

# Cache for built guardrails to avoid rebuilding on every request
_rails_cache: dict[str, tuple[LLMRails, str]] = {}  # config_id -> (rails, tmpdir_path)
_tmpdir_registry: dict[str, tempfile.TemporaryDirectory] = {}  # Keep tmpdir alive


def _fail_closed() -> bool:
    """Whether guardrails should fail closed (block) on internal errors.

    Controlled by the GUARDRAILS_FAIL_MODE env var:
      - "open"   (default): errors let content pass through (fail open)
      - "closed":           errors block the content (fail closed)

    Read at call time so the mode can be changed without a restart.
    """
    return os.getenv("GUARDRAILS_FAIL_MODE", "open").strip().lower() == "closed"


def _error_result(log_entries: list[str], stage: str) -> GuardrailResult:
    """Build a GuardrailResult for an internal guardrail error, honoring fail mode."""
    if _fail_closed():
        log_entries.append(f"🔒 Fail-closed: blocking {stage} due to guardrail error")
        return GuardrailResult(
            passed=False,
            blocked=True,
            rails_triggered=[f"{stage}_error_blocked"],
            log=log_entries,
        )
    log_entries.append(f"🔓 Fail-open: passing {stage} through despite guardrail error")
    return GuardrailResult(passed=True, log=log_entries)


# ─── Input/Output Guardrails (for agent pipeline) ────────────────────────────────


async def run_input_guardrail(
    config: GuardrailConfig,
    message: str,
) -> GuardrailResult:
    """Run input guardrails to validate/transform user message before agent."""
    log_entries: list[str] = []
    rails_triggered: list[str] = []

    try:
        rails = _build_rails_cached(config, log_entries)
        if not rails:
            log_entries.append("⚠️ Failed to build rails")
            return _error_result(log_entries, "input")

        messages = [{"role": "user", "content": message}]
        log_entries.append(f"Running input guardrail: {config.name} (id: {config.id})")

        response = await rails.generate_async(messages=messages)
        response_text = _extract_response_text(response)
        log_entries.append(f"Input rail response: {response_text[:200]}")

        # Determine if blocked
        blocked = _is_blocked_response(response_text, message, config)
        if blocked:
            rails_triggered.append("input_blocked")
            log_entries.append(f"⚠️ Input message BLOCKED by guardrail: {config.name}")
        else:
            log_entries.append(f"✓ Input message PASSED guardrail: {config.name}")

        return GuardrailResult(
            passed=not blocked,
            blocked=blocked,
            rails_triggered=rails_triggered,
            modified_content=None if blocked else (response_text if response_text != message else None),
            log=log_entries,
        )

    except Exception as e:
        logger.exception(f"Error in input guardrail ({config.name})")
        log_entries.append(f"❌ Input guardrail error: {str(e)}")
        return _error_result(log_entries, "input")


async def run_output_guardrail(
    config: GuardrailConfig,
    agent_response: str,
) -> GuardrailResult:
    """Run output guardrails to validate/transform agent response before user."""
    log_entries: list[str] = []
    rails_triggered: list[str] = []

    try:
        rails = _build_rails_cached(config, log_entries)
        if not rails:
            log_entries.append("⚠️ Failed to build rails")
            return _error_result(log_entries, "output")

        log_entries.append(f"Running output guardrail: {config.name} (id: {config.id})")

        # For output rails, send the agent response as user message to validate it
        messages = [{"role": "user", "content": agent_response}]
        response = await rails.generate_async(messages=messages)
        response_text = _extract_response_text(response)
        log_entries.append(f"Output rail response: {response_text[:200]}")

        blocked = _is_blocked_response(response_text, agent_response, config)
        if blocked:
            rails_triggered.append("output_blocked")
            log_entries.append(f"⚠️ Agent response BLOCKED by output guardrail: {config.name}")
        else:
            log_entries.append(f"✓ Agent response PASSED output guardrail: {config.name}")

        # If the response changed, it was transformed by rails
        modified = response_text if response_text != agent_response and not blocked else None
        if modified:
            rails_triggered.append("output_modified")
            log_entries.append("Output was modified by guardrails")

        return GuardrailResult(
            passed=not blocked,
            blocked=blocked,
            rails_triggered=rails_triggered,
            modified_content=modified,
            log=log_entries,
        )

    except Exception as e:
        logger.exception(f"Error in output guardrail ({config.name})")
        log_entries.append(f"❌ Output guardrail error: {str(e)}")
        return _error_result(log_entries, "output")


# ─── Legacy: Full Guardrail Test (config-only mode) ──────────────────────────────


async def run_guardrails(
    config: GuardrailConfig,
    message: str,
    history: list[ChatMessage],
) -> ChatResponse:
    """Run a message through the guardrails and return the response (legacy mode)."""
    log_entries: list[str] = []
    guardrails_triggered: list[str] = []
    blocked = False

    try:
        rails = _build_rails_cached(config, log_entries)
        if not rails:
            return ChatResponse(
                response="Failed to initialize guardrails",
                guardrails_triggered=[],
                blocked=False,
                log=log_entries,
            )

        # Build message history
        messages = []
        for msg in history:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": message})

        # Generate response
        response = await rails.generate_async(messages=messages)
        log_entries.append("Response generated successfully")

        response_text = _extract_response_text(response)

        # Check if the response indicates blocking
        blocked = _is_blocked_response(response_text, message, config)
        if blocked:
            guardrails_triggered.append("output_blocked")
            log_entries.append("⚠️ Response appears to be blocked by guardrails")

        return ChatResponse(
            response=response_text,
            guardrails_triggered=guardrails_triggered,
            blocked=blocked,
            log=log_entries,
        )

    except Exception as e:
        logger.exception("Error running guardrails")
        log_entries.append(f"❌ Error: {str(e)}")
        return ChatResponse(
            response=f"Error running guardrails: {str(e)}",
            guardrails_triggered=[],
            blocked=False,
            log=log_entries,
        )


# ─── Helpers ─────────────────────────────────────────────────────────────────────


def _build_rails_cached(config: GuardrailConfig, log_entries: list[str]) -> Optional[LLMRails]:
    """Build or get cached NeMo Guardrails instance from config.
    
    Caches rails instances to avoid rebuilding on every request.
    The temporary directory is kept alive for the lifetime of the cache entry.
    """
    config_id = config.id or "anon"
    
    # Check cache - invalidate if config content changed
    if config_id in _rails_cache:
        cached_rails, cached_hash = _rails_cache[config_id]
        current_hash = _config_hash(config)
        if cached_hash == current_hash:
            log_entries.append(f"Using cached guardrails engine for: {config.name}")
            return cached_rails
        else:
            # Config changed, invalidate cache
            log_entries.append(f"Config changed, rebuilding guardrails for: {config.name}")
            _invalidate_cache(config_id)
    
    # Build new rails instance
    try:
        # Create persistent temp directory (not auto-deleted)
        tmpdir_obj = tempfile.TemporaryDirectory()
        tmpdir = tmpdir_obj.name
        
        yaml_content = config.yaml_content.strip()
        if not yaml_content:
            yaml_content = _default_yaml_config()

        config_path = Path(tmpdir) / "config.yml"
        config_path.write_text(yaml_content)
        log_entries.append(f"Loaded config.yml for: {config.name}")

        if config.colang_content.strip():
            rails_path = Path(tmpdir) / "rails.co"
            rails_path.write_text(config.colang_content)
            log_entries.append(f"Loaded Colang rails definition ({len(config.colang_content)} chars)")

        if config.prompts_content.strip():
            prompts_path = Path(tmpdir) / "prompts.yml"
            prompts_path.write_text(config.prompts_content)
            log_entries.append("Loaded prompts.yml")

        rails_config = RailsConfig.from_path(tmpdir)
        rails = LLMRails(rails_config)
        log_entries.append(f"NeMo Guardrails engine initialized for: {config.name}")
        
        # Cache the rails instance AND keep the tmpdir alive
        _rails_cache[config_id] = (rails, _config_hash(config))
        _tmpdir_registry[config_id] = tmpdir_obj
        
        return rails
        
    except Exception as e:
        log_entries.append(f"❌ Failed to build rails for '{config.name}': {str(e)}")
        logger.exception(f"Failed to build NeMo rails for config: {config.name}")
        return None


def _config_hash(config: GuardrailConfig) -> str:
    """Create a simple hash of config content for cache invalidation."""
    content = f"{config.yaml_content}|{config.colang_content}|{config.prompts_content}"
    return str(hash(content))


def _invalidate_cache(config_id: str):
    """Remove a config from cache and clean up temp directory."""
    if config_id in _rails_cache:
        del _rails_cache[config_id]
    if config_id in _tmpdir_registry:
        try:
            _tmpdir_registry[config_id].cleanup()
        except Exception:
            pass
        del _tmpdir_registry[config_id]


def invalidate_all_caches():
    """Clear all cached guardrails (useful when configs are updated)."""
    for config_id in list(_rails_cache.keys()):
        _invalidate_cache(config_id)


def _extract_response_text(response) -> str:
    """Extract text from various NeMo response formats."""
    if response is None:
        return ""
    
    # NeMo generate_async typically returns a dict with 'content'
    if isinstance(response, dict):
        content = response.get("content", "")
        if content:
            return content
        # Sometimes nested in 'messages'
        messages = response.get("messages", [])
        if messages:
            last_msg = messages[-1] if isinstance(messages, list) else messages
            if isinstance(last_msg, dict):
                return last_msg.get("content", str(response))
        return str(response)
    
    # String response
    if isinstance(response, str):
        return response
    
    # Object with content attribute
    if hasattr(response, "content"):
        return response.content
    
    return str(response)


def _is_blocked_response(text: str, original_input: str, config: GuardrailConfig) -> bool:
    """Determine if a response indicates the input was blocked.
    
    Uses multiple heuristics:
    1. Standard blocked phrases
    2. Bot refusal patterns from Colang definitions
    3. Response differs significantly from input (for input rails)
    4. Response contains known refusal patterns
    """
    if not text:
        return False
    
    text_lower = text.lower().strip()
    
    # Standard blocked indicators
    blocked_indicators = [
        "i'm sorry, i can't",
        "i cannot help with that",
        "i'm not able to help",
        "i refuse",
        "i can't assist with",
        "that request is not allowed",
        "i'm unable to",
        "i can't provide",
        "i can't help with",
        "i won't help with",
        "i won't provide",
        "i cannot assist",
        "i cannot provide",
        "i'm not going to",
        "this is not something i can",
        "i'm designed to be helpful within my guidelines",
        "i notice you're trying to",
        "i'm designed to be safe",
        "please don't share personal information",
        "please don't share sensitive",
        "i can't securely handle",
        "that information could endanger",
        "blocked by",
        "should be blocked",
    ]
    
    if any(indicator in text_lower for indicator in blocked_indicators):
        return True
    
    # Check for NeMo's built-in refusal patterns
    nemo_refusal_patterns = [
        "i am not able to",
        "as an ai, i cannot",
        "my guidelines do not allow",
        "this goes against my programming",
        "i must decline",
        "i need to decline",
        "i can not fulfill",
        "that falls outside",
        "against my safety",
        "violates my guidelines",
        "not within my guidelines",
        "against my instructions",
    ]
    
    if any(pattern in text_lower for pattern in nemo_refusal_patterns):
        return True
    
    # Check bot refusal responses defined in Colang content
    colang_content = config.colang_content.lower() if config.colang_content else ""
    if colang_content:
        # Extract bot refusal messages from Colang
        # Look for lines starting with "define bot refuse" then the quoted message
        import re
        # Find all quoted bot responses after "define bot refuse" blocks
        refusal_quotes = re.findall(r'define bot (?:refuse|respond to)\s+\w+\s+\"(.+?)\"', colang_content)
        for quote in refusal_quotes:
            if quote.lower() in text_lower:
                return True
        
        # Also check if the response text appears in any bot response definition
        # Extract all bot response text (lines starting with quotes in bot definitions)
        bot_responses = re.findall(r'^\s*\"(.+?)\"\s*$', colang_content, re.MULTILINE)
        for bot_resp in bot_responses:
            # If bot refusal text is substantially present in response
            if len(bot_resp) > 20 and bot_resp.lower()[:50] in text_lower:
                return True
    
    # Check for self_check prompt responses ("Yes" means blocked)
    # NeMo's self_check_input returns just "Yes" or "No" which then triggers blocking
    if text_lower.strip() in ("yes", "yes."):
        return True
    
    # If response is very short and differs from input, could be a block
    # (NeMo sometimes returns empty or minimal responses when blocking)
    if len(text.strip()) < 5 and text.strip().lower() != original_input.strip().lower()[:5]:
        # Very short response that's not the input - might be blocked
        # Only flag if it looks like a clear refusal
        pass
    
    return False


def _default_yaml_config() -> str:
    """Return a default YAML config for NeMo Guardrails."""
    return """models:
  - type: main
    engine: openai
    model: gpt-5.4-nano

instructions:
  - type: general
    content: |
      Below is a conversation between a user and a bot called the Guardrails Test Bot.
      The bot is helpful, polite, and concise.
      The bot refuses harmful, violent, illegal, or inappropriate requests.

sample_conversation: |
  user "Hello"
    express greeting
  bot express greeting
    "Hello! How can I help you today?"
"""
