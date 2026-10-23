import type {
  GuardrailConfig,
  GuardrailConfigSummary,
  AgentDefinition,
  AgentSummary,
  ChatRequest,
  ChatResponse,
  AgentChatRequest,
  AgentChatResponse,
  DecisionBackend,
} from "../types";

const BASE_URL = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "Request failed");
  }
  return res.json();
}

export const api = {
  // ─── Configurations ─────────────────────────────────────────────────────────

  listConfigs: () => request<GuardrailConfigSummary[]>("/configs/"),

  getConfig: (id: string) => request<GuardrailConfig>(`/configs/${id}`),

  createConfig: (config: GuardrailConfig) =>
    request<GuardrailConfig>("/configs/", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  updateConfig: (id: string, config: GuardrailConfig) =>
    request<GuardrailConfig>(`/configs/${id}`, {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  deleteConfig: (id: string) =>
    request<{ message: string }>(`/configs/${id}`, { method: "DELETE" }),

  exportConfig: (id: string) =>
    request<{ config_yml: string; colang_content: string; prompts_yml: string }>(
      `/configs/${id}/export`
    ),

  // ─── Config Versions ────────────────────────────────────────────────────────

  listConfigVersions: (id: string) =>
    request<{ version: number; timestamp: number; message: string }[]>(
      `/configs/${id}/versions`
    ),

  getConfigVersion: (id: string, version: number) =>
    request<{ version: number; timestamp: number; message: string; data: GuardrailConfig }>(
      `/configs/${id}/versions/${version}`
    ),

  restoreConfigVersion: (id: string, version: number) =>
    request<GuardrailConfig>(`/configs/${id}/versions/${version}/restore`, {
      method: "POST",
    }),

  // ─── Templates ──────────────────────────────────────────────────────────────

  listTemplates: () =>
    request<{ id: string; name: string; description: string }[]>("/templates/"),

  getTemplate: (id: string) => request<any>(`/templates/${id}`),

  applyTemplate: (id: string) =>
    request<GuardrailConfig>(`/templates/${id}/apply`, { method: "POST" }),

  // ─── Agents ─────────────────────────────────────────────────────────────────

  listAgents: () => request<AgentSummary[]>("/agents/"),

  getAgent: (id: string) => request<AgentDefinition>(`/agents/${id}`),

  createAgent: (agent: AgentDefinition) =>
    request<AgentDefinition>("/agents/", {
      method: "POST",
      body: JSON.stringify(agent),
    }),

  updateAgent: (id: string, agent: AgentDefinition) =>
    request<AgentDefinition>(`/agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(agent),
    }),

  deleteAgent: (id: string) =>
    request<{ message: string }>(`/agents/${id}`, { method: "DELETE" }),

  getAvailableTools: () => request<string[]>("/agents/tools"),

  getProviders: () => request<Record<string, { name: string; models: string[]; env_key: string | null }>>("/agents/providers"),

  chatWithAgent: (req: AgentChatRequest) =>
    request<AgentChatResponse>("/agents/chat", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  chatWithAgentStream: (
    req: AgentChatRequest,
    onStatus: (data: { step: number; label: string; done?: boolean; blocked?: boolean; error?: boolean }) => void,
    onComplete: (data: AgentChatResponse) => void,
    onError: (error: string) => void
  ) => {
    const controller = new AbortController();

    fetch(`${BASE_URL}/agents/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          onError(err.detail || "Request failed");
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "status") {
                onStatus(data);
              } else if (currentEvent === "complete") {
                onComplete(data as AgentChatResponse);
              }
              currentEvent = "";
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          onError(err.message);
        }
      });

    return controller;
  },

  // ─── Sessions ───────────────────────────────────────────────────────────────

  listSessions: (agentId?: string) =>
    request<any[]>(`/sessions/${agentId ? `?agent_id=${agentId}` : ""}`),

  createSession: (agentId: string, name?: string) =>
    request<any>("/sessions/", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, name }),
    }),

  getSession: (id: string) => request<any>(`/sessions/${id}`),

  addSessionMessage: (id: string, message: any) =>
    request<any>(`/sessions/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(message),
    }),

  deleteSession: (id: string) =>
    request<any>(`/sessions/${id}`, { method: "DELETE" }),

  // ─── Metrics ────────────────────────────────────────────────────────────────

  getMetrics: () => request<any>("/metrics/"),

  clearMetrics: () => request<any>("/metrics/", { method: "DELETE" }),

  // ─── Batch Testing ──────────────────────────────────────────────────────────

  runBatchTest: (agentId: string, messages: string[]) =>
    request<any>("/batch/", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, messages }),
    }),

  // ─── Graph / LangGraph ────────────────────────────────────────────────────

  getGraphVisualization: () => request<{ mermaid: string }>("/graph/visualization"),

  getAgentGraph: (agentId: string) =>
    request<{
      mermaid: string;
      agent_name: string;
      provider: string;
      model: string;
      input_rails: string[];
      output_rails: string[];
    }>(`/graph/visualization/${agentId}`),

  // ─── Local Classifier ───────────────────────────────────────────────────────

  getClassifierModel: () => request<any>("/classifier/model"),

  getClassifierCategories: () => request<any>("/classifier/categories"),

  addClassifierCategory: (name: string, config: any) =>
    request<any>(`/classifier/categories/${name}`, {
      method: "POST",
      body: JSON.stringify(config),
    }),

  deleteClassifierCategory: (name: string) =>
    request<any>(`/classifier/categories/${name}`, { method: "DELETE" }),

  classifyText: (text: string, backend?: DecisionBackend) =>
    request<any>("/classifier/classify", {
      method: "POST",
      body: JSON.stringify({ text, backend }),
    }),

  batchClassify: (texts: string[], backend?: DecisionBackend) =>
    request<any>("/classifier/batch", {
      method: "POST",
      body: JSON.stringify({ texts, backend }),
    }),

  // ─── Classifier Decision Backend (bert | strands | combined) ──────────────

  getDecisionBackend: () =>
    request<{
      backend: DecisionBackend;
      available_backends: DecisionBackend[];
      strands: { url: string; model: string; available: boolean; error?: string };
    }>("/classifier/backend"),

  setDecisionBackend: (backend: DecisionBackend) =>
    request<{ backend: DecisionBackend; message: string; strands?: any }>(
      "/classifier/backend",
      { method: "PUT", body: JSON.stringify({ backend }) }
    ),

  // ─── Legacy Config-Only Chat ────────────────────────────────────────────────

  sendMessage: (req: ChatRequest) =>
    request<ChatResponse>("/chat/", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  // ─── Red Team Testing ───────────────────────────────────────────────────────

  getRedTeamCategories: () => request<any[]>("/redteam/categories"),

  getRedTeamPrompts: (category: string) =>
    request<{ category: string; prompts: string[]; count: number }>(
      `/redteam/prompts/${category}`
    ),

  runRedTeam: (agentId: string, categories?: string[]) =>
    request<any>("/redteam/run", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, categories }),
    }),

  runRedTeamStream: (
    agentId: string,
    categories: string[],
    onStart: (data: { run_id: string; total: number; categories: string[] }) => void,
    onProgress: (data: { index: number; total: number; category: string; prompt: string; eta_ms: number }) => void,
    onResult: (data: any) => void,
    onComplete: (data: any) => void,
    onError: (error: string) => void,
  ) => {
    const controller = new AbortController();

    fetch(`${BASE_URL}/redteam/run/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, categories }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          onError(err.detail || "Request failed");
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (currentEvent === "start") {
                  onStart(data);
                } else if (currentEvent === "progress") {
                  onProgress(data);
                } else if (currentEvent === "result") {
                  onResult(data);
                } else if (currentEvent === "complete") {
                  onComplete(data);
                } else if (currentEvent === "error") {
                  onError(data.error || "Unknown error");
                }
              } catch {
                // skip malformed JSON
              }
              currentEvent = "";
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          onError(err.message);
        }
      });

    return controller;
  },

  cancelRedTeamRun: (runId: string) =>
    request<{ success: boolean }>("/redteam/cancel", {
      method: "POST",
      body: JSON.stringify({ run_id: runId }),
    }),

  // Red Team Run History
  getRedTeamRuns: () => request<any[]>("/redteam/runs"),

  getRedTeamRun: (runId: string) => request<any>(`/redteam/runs/${runId}`),

  deleteRedTeamRun: (runId: string) =>
    request<{ success: boolean }>(`/redteam/runs/${runId}`, { method: "DELETE" }),

  // Red Team Triage
  updateRedTeamTriage: (runId: string, testIndex: number, data: { status: string; severity: string; notes: string }) =>
    request<{ success: boolean }>(`/redteam/runs/${runId}/triage/${testIndex}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Red Team Custom Prompts
  getRedTeamCustomPrompts: () => request<Record<string, string[]>>("/redteam/prompts-custom"),

  addRedTeamPrompt: (category: string, prompt: string) =>
    request<any>("/redteam/prompts", {
      method: "POST",
      body: JSON.stringify({ category, prompt }),
    }),

  editRedTeamPrompt: (category: string, index: number, prompt: string) =>
    request<any>(`/redteam/prompts/${category}/${index}`, {
      method: "PUT",
      body: JSON.stringify({ prompt }),
    }),

  deleteRedTeamPrompt: (category: string, index: number) =>
    request<any>(`/redteam/prompts/${category}/${index}`, { method: "DELETE" }),

  createRedTeamCategory: (name: string, description: string) =>
    request<any>("/redteam/categories", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),

  // Red Team Import/Export
  exportRedTeamPrompts: () => request<{ prompts: Record<string, string[]> }>("/redteam/export"),

  importRedTeamPrompts: (prompts: Record<string, string[]>) =>
    request<{ success: boolean; imported_count: number }>("/redteam/import", {
      method: "POST",
      body: JSON.stringify({ prompts }),
    }),

  // ─── A/B Testing ───────────────────────────────────────────────────────────

  runABTest: (configAId: string, configBId: string, testMessages: string[]) =>
    request<any>("/ab-test/run", {
      method: "POST",
      body: JSON.stringify({
        config_a_id: configAId,
        config_b_id: configBId,
        test_messages: testMessages,
      }),
    }),

  // ─── Export/Deploy ──────────────────────────────────────────────────────────

  exportAgent: (agentId: string) =>
    request<any>(`/export/agent/${agentId}`, { method: "POST" }),

  // ─── Audit Log ─────────────────────────────────────────────────────────────

  getAuditEntries: (params?: {
    agent_id?: string;
    result?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.agent_id) searchParams.set("agent_id", params.agent_id);
    if (params?.result) searchParams.set("result", params.result);
    if (params?.start_date) searchParams.set("start_date", params.start_date);
    if (params?.end_date) searchParams.set("end_date", params.end_date);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    const qs = searchParams.toString();
    return request<any>(`/audit/${qs ? `?${qs}` : ""}`);
  },

  getAuditSummary: (agentId?: string) =>
    request<any>(`/audit/summary${agentId ? `?agent_id=${agentId}` : ""}`),

  exportAudit: () => request<string>("/audit/export"),

  clearAudit: () =>
    request<{ message: string }>("/audit/", { method: "DELETE" }),
};
