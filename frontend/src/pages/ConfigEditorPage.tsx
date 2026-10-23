import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { api } from "../api/client";
import type { GuardrailConfig } from "../types";
import "./ConfigEditorPage.css";

const DEFAULT_YAML = `models:
  - type: main
    engine: openai
    model: gpt-3.5-turbo

instructions:
  - type: general
    content: |
      Below is a conversation between a user and a bot called the Guardrails Test Bot.
      The bot is helpful, polite, and concise.

sample_conversation: |
  user "Hello"
    express greeting
  bot express greeting
    "Hello! How can I help you today?"
`;

const DEFAULT_COLANG = `define user express greeting
  "hello"
  "hi"
  "what's up?"

define bot express greeting
  "Hello! How can I help you today?"

define flow
  user express greeting
  bot express greeting
`;

function ConfigEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [config, setConfig] = useState<GuardrailConfig>({
    name: "",
    description: "",
    colang_content: DEFAULT_COLANG,
    yaml_content: DEFAULT_YAML,
    prompts_content: "",
  });
  const [activeTab, setActiveTab] = useState<"yaml" | "colang" | "prompts">("yaml");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (id) {
      loadConfig(id);
    }
  }, [id]);

  async function loadConfig(configId: string) {
    try {
      setLoading(true);
      const data = await api.getConfig(configId);
      setConfig(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!config.name.trim()) {
      setError("Name is required");
      return;
    }
    try {
      setSaving(true);
      setError("");
      if (isNew) {
        const saved = await api.createConfig(config);
        setSuccess("Configuration created!");
        setTimeout(() => navigate(`/configs/${saved.id}`), 1000);
      } else {
        await api.updateConfig(id!, config);
        setSuccess("Configuration saved!");
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading">Loading configuration...</div>;

  return (
    <div className="config-editor-page">
      <div className="editor-header">
        <div>
          <h1>{isNew ? "New Configuration" : "Edit Configuration"}</h1>
          <p className="page-subtitle">
            Define your guardrail rules using Colang and YAML configuration.
          </p>
        </div>
        <div className="editor-header-actions">
          {!isNew && (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/test/${id}`)}
            >
              Test This Config
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="config-meta">
        <div className="form-group">
          <label htmlFor="config-name">Name</label>
          <input
            id="config-name"
            type="text"
            value={config.name}
            onChange={(e) => setConfig({ ...config, name: e.target.value })}
            placeholder="My Guardrail Configuration"
          />
        </div>
        <div className="form-group">
          <label htmlFor="config-desc">Description</label>
          <input
            id="config-desc"
            type="text"
            value={config.description}
            onChange={(e) => setConfig({ ...config, description: e.target.value })}
            placeholder="What does this configuration do?"
          />
        </div>
      </div>

      <div className="editor-tabs">
        <button
          className={`tab ${activeTab === "yaml" ? "active" : ""}`}
          onClick={() => setActiveTab("yaml")}
        >
          config.yml
        </button>
        <button
          className={`tab ${activeTab === "colang" ? "active" : ""}`}
          onClick={() => setActiveTab("colang")}
        >
          rails.co (Colang)
        </button>
        <button
          className={`tab ${activeTab === "prompts" ? "active" : ""}`}
          onClick={() => setActiveTab("prompts")}
        >
          prompts.yml
        </button>
      </div>

      <div className="editor-container">
        {activeTab === "yaml" && (
          <Editor
            height="500px"
            language="yaml"
            theme="vs-dark"
            value={config.yaml_content}
            onChange={(value) =>
              setConfig({ ...config, yaml_content: value || "" })
            }
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
          />
        )}
        {activeTab === "colang" && (
          <Editor
            height="500px"
            language="python"
            theme="vs-dark"
            value={config.colang_content}
            onChange={(value) =>
              setConfig({ ...config, colang_content: value || "" })
            }
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
          />
        )}
        {activeTab === "prompts" && (
          <Editor
            height="500px"
            language="yaml"
            theme="vs-dark"
            value={config.prompts_content}
            onChange={(value) =>
              setConfig({ ...config, prompts_content: value || "" })
            }
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
          />
        )}
      </div>

      <div className="editor-help">
        <details>
          <summary>Configuration Help</summary>
          <div className="help-content">
            <h4>config.yml</h4>
            <p>
              Main configuration file. Define the LLM model, instructions, and
              sample conversations. See the{" "}
              <a
                href="https://docs.nvidia.com/nemo/guardrails/user_guides/configuration-guide.html"
                target="_blank"
                rel="noreferrer"
              >
                NeMo Guardrails Configuration Guide
              </a>.
            </p>
            <h4>rails.co (Colang)</h4>
            <p>
              Define conversational flows and guardrail rules using Colang syntax.
              This is where you define user intents, bot responses, and flow logic.
            </p>
            <h4>prompts.yml</h4>
            <p>
              Optional file for custom prompt templates used by the guardrails
              engine for tasks like intent detection and fact-checking.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

export default ConfigEditorPage;
