// ─── Guardrail Configurations ───────────────────────────────────────────────────

export interface GuardrailConfig {
  id?: string;
  name: string;
  description: string;
  colang_content: string;
  yaml_content: string;
  prompts_content: string;
}

export interface GuardrailConfigSummary {
  id: string;
  name: string;
  description: string;
}

// ─── Agent Definitions ──────────────────────────────────────────────────────────

export interface AgentDefinition {
  id?: string;
  name: string;
  description: string;
  system_prompt: string;
  provider: string;
  model: string;
  api_base?: string | null;
  api_version?: string | null;
  deployment_name?: string | null;
  temperature: number;
  tools: string[];
  input_guardrail_ids: string[];
  output_guardrail_ids: string[];
  input_guardrail_id: string | null;
  output_guardrail_id: string | null;
  enabled: boolean;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  input_guardrail_id: string | null;
  output_guardrail_id: string | null;
  input_guardrail_ids: string[];
  output_guardrail_ids: string[];
  enabled: boolean;
}

// ─── Chat Messages ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  config_id: string;
  message: string;
  history: ChatMessage[];
}

export interface AgentChatRequest {
  agent_id: string;
  message: string;
  history: ChatMessage[];
  guardrails_enabled: boolean;
}

export interface GuardrailResult {
  passed: boolean;
  blocked: boolean;
  rails_triggered: string[];
  modified_content: string | null;
  log: string[];
  config_id?: string | null;
  latency_ms?: number;
}

export interface GuardrailChainResult {
  passed: boolean;
  blocked: boolean;
  results: GuardrailResult[];
  total_latency_ms: number;
}

export interface AgentChatResponse {
  response: string;
  input_guardrail: GuardrailResult | null;
  input_guardrail_chain: GuardrailChainResult | null;
  output_guardrail: GuardrailResult | null;
  output_guardrail_chain: GuardrailChainResult | null;
  agent_reasoning: string[];
  blocked: boolean;
  model_used: string;
  provider_used: string;
}

export interface ChatResponse {
  response: string;
  guardrails_triggered: string[];
  blocked: boolean;
  log: string[];
}

// ─── Classifier Decision Backend ────────────────────────────────────────────────

export type DecisionBackend = "bert" | "strands" | "combined";

export interface ClassifierCategoryResult {
  category: string;
  score: number;
  bert_score?: number;
  strands_score?: number;
  threshold: number;
  triggered: boolean;
  action: "block" | "flag" | "escalate";
  description: string;
}

export interface ClassifyResponse {
  text: string;
  results: ClassifierCategoryResult[];
  blocked: boolean;
  flagged: boolean;
  escalate: boolean;
  triggered_categories: string[];
  latency_ms: number;
  backend: DecisionBackend;
  model: string;
  strands_latency_ms?: number;
  strands_error?: string;
  performance?: unknown;
}
