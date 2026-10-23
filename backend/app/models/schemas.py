"""Pydantic models for the API."""

from pydantic import BaseModel, Field
from typing import Optional


# ─── Guardrail Configurations ───────────────────────────────────────────────────


class GuardrailConfig(BaseModel):
    """A guardrail configuration."""

    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    colang_content: str = Field(
        default="",
        description="Colang rails definition content",
    )
    yaml_content: str = Field(
        default="",
        description="YAML configuration content (config.yml)",
    )
    prompts_content: str = Field(
        default="",
        description="Prompts configuration content (prompts.yml)",
    )


class GuardrailConfigSummary(BaseModel):
    """Summary of a guardrail configuration for listing."""

    id: str
    name: str
    description: str


# ─── LLM Provider Configuration ──────────────────────────────────────────────────


class LLMProvider(BaseModel):
    """Supported LLM provider configuration."""

    provider: str = Field(
        default="openai",
        description="Provider name: openai, azure_openai, anthropic, bedrock, ollama",
    )
    model: str = Field(default="gpt-5.4-nano")
    api_base: Optional[str] = Field(
        default=None,
        description="Custom API base URL (for Azure, Ollama, etc.)",
    )
    api_version: Optional[str] = Field(
        default=None,
        description="API version (for Azure OpenAI)",
    )
    deployment_name: Optional[str] = Field(
        default=None,
        description="Deployment name (for Azure OpenAI)",
    )


# ─── Agent Definitions ───────────────────────────────────────────────────────────


class AgentTool(BaseModel):
    """A tool available to an agent."""

    name: str
    description: str


class AgentDefinition(BaseModel):
    """Definition of a LangChain agent with guardrail bindings."""

    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    system_prompt: str = Field(
        default="You are a helpful AI assistant.",
        description="System prompt for the agent",
    )

    # LLM Configuration
    provider: str = Field(
        default="openai",
        description="LLM provider: openai, azure_openai, anthropic, bedrock, ollama",
    )
    model: str = Field(
        default="gpt-5.4-nano",
        description="LLM model name",
    )
    api_base: Optional[str] = Field(
        default=None,
        description="Custom API base URL",
    )
    api_version: Optional[str] = Field(
        default=None,
        description="API version (Azure)",
    )
    deployment_name: Optional[str] = Field(
        default=None,
        description="Deployment name (Azure)",
    )
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)

    tools: list[str] = Field(
        default_factory=list,
        description="List of tool names enabled for this agent",
    )

    # Multi-guardrail support: ordered list of config IDs per stage
    input_guardrail_ids: list[str] = Field(
        default_factory=list,
        description="Ordered list of guardrail config IDs for input validation (chain)",
    )
    output_guardrail_ids: list[str] = Field(
        default_factory=list,
        description="Ordered list of guardrail config IDs for output validation (chain)",
    )

    # Legacy single-guardrail fields (backward compatible)
    input_guardrail_id: Optional[str] = Field(
        default=None,
        description="(Legacy) Single guardrail config ID for input",
    )
    output_guardrail_id: Optional[str] = Field(
        default=None,
        description="(Legacy) Single guardrail config ID for output",
    )

    enabled: bool = True

    def get_input_guardrail_ids(self) -> list[str]:
        """Get effective input guardrail IDs (supports legacy single field)."""
        if self.input_guardrail_ids:
            return self.input_guardrail_ids
        if self.input_guardrail_id:
            return [self.input_guardrail_id]
        return []

    def get_output_guardrail_ids(self) -> list[str]:
        """Get effective output guardrail IDs (supports legacy single field)."""
        if self.output_guardrail_ids:
            return self.output_guardrail_ids
        if self.output_guardrail_id:
            return [self.output_guardrail_id]
        return []


class AgentSummary(BaseModel):
    """Summary of an agent for listing."""

    id: str
    name: str
    description: str
    provider: str = "openai"
    model: str = "gpt-5.4-nano"
    input_guardrail_id: Optional[str] = None
    output_guardrail_id: Optional[str] = None
    input_guardrail_ids: list[str] = []
    output_guardrail_ids: list[str] = []
    enabled: bool = True


# ─── Chat Messages ───────────────────────────────────────────────────────────────


class ChatMessage(BaseModel):
    """A chat message."""

    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str


class ChatRequest(BaseModel):
    """Request to send a chat message for guardrail testing (config-only mode)."""

    config_id: str
    message: str
    history: list[ChatMessage] = []


class AgentChatRequest(BaseModel):
    """Request to send a message to a specific agent."""

    agent_id: str
    message: str
    history: list[ChatMessage] = []
    guardrails_enabled: bool = Field(
        default=True,
        description="Enable/disable guardrails for A/B testing",
    )


class GuardrailResult(BaseModel):
    """Result from a single guardrail pass."""

    passed: bool
    blocked: bool = False
    rails_triggered: list[str] = []
    modified_content: Optional[str] = None
    log: list[str] = []
    config_id: Optional[str] = None
    latency_ms: float = 0


class GuardrailChainResult(BaseModel):
    """Result from a chain of guardrails."""

    passed: bool
    blocked: bool = False
    results: list[GuardrailResult] = []
    total_latency_ms: float = 0


class AgentChatResponse(BaseModel):
    """Response from agent chat including guardrail trace."""

    response: str
    input_guardrail: Optional[GuardrailResult] = None
    input_guardrail_chain: Optional[GuardrailChainResult] = None
    output_guardrail: Optional[GuardrailResult] = None
    output_guardrail_chain: Optional[GuardrailChainResult] = None
    agent_reasoning: list[str] = []
    blocked: bool = False
    model_used: str = ""
    provider_used: str = ""


class ChatResponse(BaseModel):
    """Response from the guardrail testing chat (config-only mode)."""

    response: str
    guardrails_triggered: list[str] = []
    blocked: bool = False
    log: list[str] = []


# ─── Export ──────────────────────────────────────────────────────────────────────


class ExportResponse(BaseModel):
    """Response containing exported configuration files."""

    config_yml: str
    colang_content: str
    prompts_yml: str
