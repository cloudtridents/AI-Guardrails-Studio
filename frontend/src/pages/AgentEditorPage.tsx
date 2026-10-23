import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { AgentDefinition, GuardrailConfigSummary } from "../types";
import "./AgentEditorPage.css";

interface ProviderInfo {
  name: string;
  models: string[];
  env_key: string | null;
}

function AgentEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [agent, setAgent] = useState<AgentDefinition>({
    name: "",
    description: "",
    system_prompt: "You are a helpful AI assistant.",
    provider: "openai",
    model: "gpt-4o-mini",
    api_base: null,
    api_version: null,
    deployment_name: null,
    temperature: 0.7,
    tools: [],
    input_guardrail_ids: [],
    output_guardrail_ids: [],
    input_guardrail_id: null,
    output_guardrail_id: null,
    enabled: true,
  });

  const [configs, setConfigs] = useState<GuardrailConfigSummary[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    loadDependencies();
    if (id) loadAgent(id);
  }, [id]);

  async function loadDependencies() {
    try {
      const [configList, tools, provs] = await Promise.all([
        api.listConfigs(),
        api.getAvailableTools(),
        api.getProviders(),
      ]);
      setConfigs(configList);
      setAvailableTools(tools);
      setProviders(provs);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function loadAgent(agentId: string) {
    try {
      setLoading(true);
      const data = await api.getAgent(agentId);
      setAgent(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!agent.name.trim()) {
      setError("Name is required");
      return;
    }
    try {
      setSaving(true);
      setError("");
      if (isNew) {
        const saved = await api.createAgent(agent);
        setSuccess("Agent created!");
        setTimeout(() => navigate(`/agents/${saved.id}`), 1000);
      } else {
        await api.updateAgent(id!, agent);
        setSuccess("Agent saved!");
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleTool(toolName: string) {
    setAgent((prev) => ({
      ...prev,
      tools: prev.tools.includes(toolName)
        ? prev.tools.filter((t) => t !== toolName)
        : [...prev.tools, toolName],
    }));
  }

  function addGuardrail(stage: "input" | "output", configId: string) {
    if (!configId) return;
    const key = stage === "input" ? "input_guardrail_ids" : "output_guardrail_ids";
    if (agent[key].includes(configId)) return;
    setAgent((prev) => ({ ...prev, [key]: [...prev[key], configId] }));
  }

  function removeGuardrail(stage: "input" | "output", index: number) {
    const key = stage === "input" ? "input_guardrail_ids" : "output_guardrail_ids";
    setAgent((prev) => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== index),
    }));
  }

  function moveGuardrail(stage: "input" | "output", index: number, direction: -1 | 1) {
    const key = stage === "input" ? "input_guardrail_ids" : "output_guardrail_ids";
    const arr = [...agent[key]];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= arr.length) return;
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    setAgent((prev) => ({ ...prev, [key]: arr }));
  }

  const currentProvider = providers[agent.provider] || { name: "OpenAI", models: ["gpt-4o-mini"], env_key: null };

  if (loading) return <div className="loading">Loading agent...</div>;

  return (
    <div className="agent-editor-page">
      <div className="editor-header">
        <div>
          <h1>{isNew ? "New Agent" : "Configure Agent"}</h1>
          <p className="page-subtitle">
            Define the agent's behavior, LLM provider, tools, and guardrail chain.
          </p>
        </div>
        <div className="editor-header-actions">
          {!isNew && (
            <button className="btn btn-primary" onClick={() => navigate(`/agents/${id}/test`)}>
              Test Agent
            </button>
          )}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="agent-form">
        {/* Basic Info */}
        <section className="form-section">
          <h2>Basic Information</h2>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="agent-name">Name</label>
              <input id="agent-name" type="text" value={agent.name} onChange={(e) => setAgent({ ...agent, name: e.target.value })} placeholder="My AI Agent" />
            </div>
            <div className="form-group">
              <label htmlFor="agent-desc">Description</label>
              <input id="agent-desc" type="text" value={agent.description} onChange={(e) => setAgent({ ...agent, description: e.target.value })} placeholder="What does this agent do?" />
            </div>
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input type="checkbox" checked={agent.enabled} onChange={(e) => setAgent({ ...agent, enabled: e.target.checked })} />
              Agent enabled
            </label>
          </div>
        </section>

        {/* LLM Provider */}
        <section className="form-section">
          <h2>LLM Provider</h2>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="agent-provider">Provider</label>
              <select id="agent-provider" value={agent.provider} onChange={(e) => {
                const prov = e.target.value;
                const models = providers[prov]?.models || [];
                setAgent({ ...agent, provider: prov, model: models[0] || "gpt-4o-mini" });
              }}>
                {Object.entries(providers).map(([key, info]) => (
                  <option key={key} value={key}>{info.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="agent-model">Model</label>
              <select id="agent-model" value={agent.model} onChange={(e) => setAgent({ ...agent, model: e.target.value })}>
                {currentProvider.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="agent-temp">Temperature: {agent.temperature.toFixed(1)}</label>
              <input id="agent-temp" type="range" min="0" max="2" step="0.1" value={agent.temperature} onChange={(e) => setAgent({ ...agent, temperature: parseFloat(e.target.value) })} />
            </div>
            <div className="form-group">
              <label htmlFor="agent-api-base">API Base URL (optional)</label>
              <input id="agent-api-base" type="text" value={agent.api_base || ""} onChange={(e) => setAgent({ ...agent, api_base: e.target.value || null })} placeholder={agent.provider === "ollama" ? "http://localhost:11434" : "https://your-endpoint.openai.azure.com/"} />
            </div>
          </div>
          {agent.provider === "azure_openai" && (
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="agent-api-version">API Version</label>
                <input id="agent-api-version" type="text" value={agent.api_version || ""} onChange={(e) => setAgent({ ...agent, api_version: e.target.value || null })} placeholder="2024-02-01" />
              </div>
              <div className="form-group">
                <label htmlFor="agent-deployment">Deployment Name</label>
                <input id="agent-deployment" type="text" value={agent.deployment_name || ""} onChange={(e) => setAgent({ ...agent, deployment_name: e.target.value || null })} placeholder="my-gpt4-deployment" />
              </div>
            </div>
          )}
          {currentProvider.env_key && (
            <p className="provider-hint">Requires env variable: <code>{currentProvider.env_key}</code></p>
          )}
        </section>

        {/* System Prompt */}
        <section className="form-section">
          <h2>System Prompt</h2>
          <div className="form-group">
            <textarea className="system-prompt-input" value={agent.system_prompt} onChange={(e) => setAgent({ ...agent, system_prompt: e.target.value })} placeholder="Define the agent's personality..." rows={6} />
          </div>
        </section>

        {/* Tools */}
        <section className="form-section">
          <h2>Tools</h2>
          <p className="section-hint">Select which tools this agent can use.</p>
          <div className="tools-grid">
            {availableTools.map((tool) => (
              <label key={tool} className="tool-checkbox">
                <input type="checkbox" checked={agent.tools.includes(tool)} onChange={() => toggleTool(tool)} />
                <span className="tool-name">{tool}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Guardrail Chain */}
        <section className="form-section">
          <h2>Guardrail Pipeline (Chained)</h2>
          <p className="section-hint">
            Add multiple guardrails per stage. They run in order — first match blocks.
            Drag to reorder. Earlier rails should be fast/cheap checks.
          </p>

          {/* Input Chain */}
          <div className="guardrail-chain">
            <h3>🛡️ Input Guardrails (runs before agent)</h3>
            <div className="chain-list">
              {agent.input_guardrail_ids.map((cid, i) => {
                const config = configs.find((c) => c.id === cid);
                return (
                  <div key={`${cid}-${i}`} className="chain-item">
                    <span className="chain-order">{i + 1}</span>
                    <span className="chain-name">{config?.name || cid}</span>
                    <div className="chain-actions">
                      <button onClick={() => moveGuardrail("input", i, -1)} disabled={i === 0} title="Move up">↑</button>
                      <button onClick={() => moveGuardrail("input", i, 1)} disabled={i === agent.input_guardrail_ids.length - 1} title="Move down">↓</button>
                      <button onClick={() => removeGuardrail("input", i)} className="remove-btn" title="Remove">×</button>
                    </div>
                  </div>
                );
              })}
              {agent.input_guardrail_ids.length === 0 && (
                <p className="chain-empty">No input guardrails assigned.</p>
              )}
            </div>
            <select className="chain-add" value="" onChange={(e) => { addGuardrail("input", e.target.value); e.target.value = ""; }}>
              <option value="">+ Add input guardrail...</option>
              {configs.filter((c) => !agent.input_guardrail_ids.includes(c.id)).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Output Chain */}
          <div className="guardrail-chain">
            <h3>🔍 Output Guardrails (runs after agent)</h3>
            <div className="chain-list">
              {agent.output_guardrail_ids.map((cid, i) => {
                const config = configs.find((c) => c.id === cid);
                return (
                  <div key={`${cid}-${i}`} className="chain-item">
                    <span className="chain-order">{i + 1}</span>
                    <span className="chain-name">{config?.name || cid}</span>
                    <div className="chain-actions">
                      <button onClick={() => moveGuardrail("output", i, -1)} disabled={i === 0} title="Move up">↑</button>
                      <button onClick={() => moveGuardrail("output", i, 1)} disabled={i === agent.output_guardrail_ids.length - 1} title="Move down">↓</button>
                      <button onClick={() => removeGuardrail("output", i)} className="remove-btn" title="Remove">×</button>
                    </div>
                  </div>
                );
              })}
              {agent.output_guardrail_ids.length === 0 && (
                <p className="chain-empty">No output guardrails assigned.</p>
              )}
            </div>
            <select className="chain-add" value="" onChange={(e) => { addGuardrail("output", e.target.value); e.target.value = ""; }}>
              <option value="">+ Add output guardrail...</option>
              {configs.filter((c) => !agent.output_guardrail_ids.includes(c.id)).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </section>
      </div>
    </div>
  );
}

export default AgentEditorPage;
