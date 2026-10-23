import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type {
  AgentDefinition,
  ChatMessage,
  AgentChatResponse,
  GuardrailResult,
} from "../types";
import "./AgentTestingPage.css";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  meta?: {
    input_guardrail: GuardrailResult | null;
    output_guardrail: GuardrailResult | null;
    agent_reasoning: string[];
    blocked: boolean;
    model_used: string;
  };
}

interface SessionInfo {
  id: string;
  name: string;
  message_count: number;
  created_at: number;
}

function AgentTestingPage() {
  const { id } = useParams();
  const [agent, setAgent] = useState<AgentDefinition | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [pipelineLabel, setPipelineLabel] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");
  const [guardrailsEnabled, setGuardrailsEnabled] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<number | null>(null);

  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [showSessions, setShowSessions] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      loadAgent(id);
      loadSessions(id);
    }
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pipelineStep]);

  async function loadAgent(agentId: string) {
    try {
      setPageLoading(true);
      const data = await api.getAgent(agentId);
      setAgent(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPageLoading(false);
    }
  }

  async function loadSessions(agentId: string) {
    try {
      const data = await api.listSessions(agentId);
      setSessions(data);
    } catch {
      // Non-critical
    }
  }

  async function startNewSession() {
    if (!id) return;
    try {
      const session = await api.createSession(id);
      setSessionId(session.id);
      setMessages([]);
      setSelectedTrace(null);
      loadSessions(id);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function loadSession(sid: string) {
    try {
      const session = await api.getSession(sid);
      setSessionId(session.id);
      setMessages(session.messages || []);
      setSelectedTrace(null);
      setShowSessions(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteSession(sid: string) {
    if (!confirm("Delete this session?")) return;
    try {
      await api.deleteSession(sid);
      if (sessionId === sid) {
        setSessionId(null);
        setMessages([]);
      }
      if (id) loadSessions(id);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function persistMessage(msg: DisplayMessage) {
    if (!sessionId) return;
    try {
      await api.addSessionMessage(sessionId, msg);
    } catch {
      // Non-critical: session save failure doesn't block UX
    }
  }

  function handleSend() {
    if (!input.trim() || !id || loading) return;

    const userMessage: DisplayMessage = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    persistMessage(userMessage);
    const currentInput = input;
    setInput("");
    setLoading(true);
    setError("");
    setPipelineStep(0);
    setPipelineLabel("Starting pipeline...");

    const history: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    api.chatWithAgentStream(
      {
        agent_id: id,
        message: currentInput,
        history,
        guardrails_enabled: guardrailsEnabled,
      },
      (data) => {
        setPipelineStep(data.step);
        setPipelineLabel(data.label);
      },
      (data) => {
        const assistantMessage: DisplayMessage = {
          role: "assistant",
          content: data.response,
          meta: {
            input_guardrail: data.input_guardrail,
            output_guardrail: data.output_guardrail,
            agent_reasoning: data.agent_reasoning,
            blocked: data.blocked,
            model_used: data.model_used,
          },
        };
        setMessages((prev) => [...prev, assistantMessage]);
        persistMessage(assistantMessage);
        setLoading(false);
        setPipelineStep(0);
        setPipelineLabel("");
      },
      (errMsg) => {
        setError(errMsg);
        setLoading(false);
        setPipelineStep(0);
        setPipelineLabel("");
      }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (pageLoading) return <div className="loading">Loading agent...</div>;
  if (!agent) return <div className="error-banner">Agent not found</div>;

  const selectedMsg = selectedTrace !== null ? messages[selectedTrace] : null;

  return (
    <div className="agent-testing-page">
      <div className="testing-header">
        <div>
          <h1>Test: {agent.name}</h1>
          <p className="page-subtitle">
            <span className="meta-tag model-tag">{agent.model}</span>
            {agent.input_guardrail_id && (
              <span className="meta-tag rail-tag">Input Rails</span>
            )}
            {agent.output_guardrail_id && (
              <span className="meta-tag rail-tag">Output Rails</span>
            )}
            {sessionId && (
              <span className="meta-tag session-tag">Session: {sessionId}</span>
            )}
          </p>
        </div>
        <div className="testing-header-actions">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={guardrailsEnabled}
              onChange={(e) => setGuardrailsEnabled(e.target.checked)}
            />
            Guardrails {guardrailsEnabled ? "ON" : "OFF"}
          </label>
          <button className="btn btn-secondary" onClick={() => setShowSessions(!showSessions)}>
            Sessions
          </button>
          <Link to={`/agents/${id}/compare`} className="btn btn-secondary">
            A/B Compare
          </Link>
          <Link to={`/agents/${id}`} className="btn btn-secondary">
            Configure
          </Link>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setMessages([]);
              setSelectedTrace(null);
              setSessionId(null);
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Sessions Sidebar */}
      {showSessions && (
        <div className="sessions-panel">
          <div className="sessions-header">
            <h4>Chat Sessions</h4>
            <button className="btn btn-primary btn-sm" onClick={startNewSession}>
              + New Session
            </button>
          </div>
          {sessions.length === 0 ? (
            <p className="sessions-empty">No saved sessions. Start a new one to persist chat history.</p>
          ) : (
            <div className="sessions-list">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`session-item ${s.id === sessionId ? "active" : ""}`}
                >
                  <div className="session-info" onClick={() => loadSession(s.id)}>
                    <span className="session-name">{s.name}</span>
                    <span className="session-meta">
                      {s.message_count} messages · {new Date(s.created_at * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    className="session-delete"
                    onClick={() => deleteSession(s.id)}
                    aria-label="Delete session"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="testing-layout">
        {/* Chat Panel */}
        <div className="chat-panel">
          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>Send a message to test the agent pipeline.</p>
                <p className="hint">
                  Toggle guardrails ON/OFF to compare behavior. Click a response
                  to see the full trace. Use Sessions to persist conversations.
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`chat-message ${msg.role} ${msg.meta?.blocked ? "blocked" : ""} ${selectedTrace === i ? "selected" : ""}`}
                onClick={() => msg.meta && setSelectedTrace(i)}
              >
                <div className="message-role">
                  {msg.role === "user" ? "You" : agent.name}
                </div>
                <div className="message-content">{msg.content}</div>
                {msg.meta && (
                  <div className="message-badges">
                    {msg.meta.blocked && (
                      <span className="badge badge-blocked">Blocked</span>
                    )}
                    {!guardrailsEnabled && (
                      <span className="badge badge-noguard">No Guardrails</span>
                    )}
                    {msg.meta.input_guardrail?.rails_triggered.length ? (
                      <span className="badge badge-input">Input Rail</span>
                    ) : null}
                    {msg.meta.output_guardrail?.rails_triggered.length ? (
                      <span className="badge badge-output">Output Rail</span>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="chat-message assistant loading-msg">
                <div className="message-role">{agent.name}</div>
                <PipelineStatus
                  step={pipelineStep}
                  label={pipelineLabel}
                  guardrailsEnabled={guardrailsEnabled}
                  hasInputRail={!!agent.input_guardrail_id}
                  hasOutputRail={!!agent.output_guardrail_id}
                />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-container">
            <textarea
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send)"
              rows={2}
              disabled={loading}
              aria-label="Chat message input"
            />
            <button
              className="btn btn-primary send-btn"
              onClick={handleSend}
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </div>
        </div>

        {/* Trace Panel */}
        <div className="trace-panel">
          <h3>Pipeline Trace</h3>
          {!selectedMsg?.meta ? (
            <div className="trace-empty">
              Click a bot response to see the guardrail trace.
            </div>
          ) : (
            <div className="trace-content">
              <div className="trace-flow">
                <TraceStep
                  label="Input Guardrails"
                  result={selectedMsg.meta.input_guardrail}
                  type="input"
                />
                <div className="trace-arrow">↓</div>
                <TraceStep
                  label="LangChain Agent"
                  type="agent"
                  model={selectedMsg.meta.model_used}
                />
                <div className="trace-arrow">↓</div>
                <TraceStep
                  label="Output Guardrails"
                  result={selectedMsg.meta.output_guardrail}
                  type="output"
                />
              </div>

              <div className="trace-section">
                <h4>Agent Reasoning</h4>
                <div className="trace-log">
                  {selectedMsg.meta.agent_reasoning.map((entry, j) => (
                    <div key={j} className="log-entry">{entry}</div>
                  ))}
                </div>
              </div>

              {selectedMsg.meta.input_guardrail && (
                <div className="trace-section">
                  <h4>Input Guardrail Log</h4>
                  <div className="trace-log">
                    {selectedMsg.meta.input_guardrail.log.map((entry, j) => (
                      <div key={j} className="log-entry">{entry}</div>
                    ))}
                  </div>
                </div>
              )}

              {selectedMsg.meta.output_guardrail && (
                <div className="trace-section">
                  <h4>Output Guardrail Log</h4>
                  <div className="trace-log">
                    {selectedMsg.meta.output_guardrail.log.map((entry, j) => (
                      <div key={j} className="log-entry">{entry}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline Status Indicator ────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { label: "Checking input guardrails", icon: "🛡️" },
  { label: "Agent is thinking", icon: "🧠" },
  { label: "Generating response", icon: "✍️" },
  { label: "Validating output guardrails", icon: "🔍" },
];

function PipelineStatus({
  step,
  label,
  guardrailsEnabled,
  hasInputRail,
  hasOutputRail,
}: {
  step: number;
  label: string;
  guardrailsEnabled: boolean;
  hasInputRail: boolean;
  hasOutputRail: boolean;
}) {
  const icons = ["🛡️", "🧠", "✍️", "🔍"];
  const icon = icons[step] || "⏳";

  const visibleSteps = [0, 1, 2, 3].filter((i) => {
    if (i === 0 && (!guardrailsEnabled || !hasInputRail)) return false;
    if (i === 3 && (!guardrailsEnabled || !hasOutputRail)) return false;
    return true;
  });

  return (
    <div className="pipeline-status">
      <div className="pipeline-current">
        <span className="pipeline-icon">{icon}</span>
        <span className="pipeline-label">{label}</span>
        <span className="pipeline-dots"><span>.</span><span>.</span><span>.</span></span>
      </div>
      <div className="pipeline-steps">
        {visibleSteps.map((s) => {
          const isActive = s === step;
          const isPast = s < step;
          return (
            <div
              key={s}
              className={`pipeline-step-dot ${isActive ? "active" : ""} ${isPast ? "done" : ""}`}
              title={PIPELINE_STEPS[s].label}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Trace Step Component ─────────────────────────────────────────────────────

function TraceStep({
  label,
  result,
  type,
  model,
}: {
  label: string;
  result?: GuardrailResult | null;
  type: "input" | "output" | "agent";
  model?: string;
}) {
  let status: "passed" | "blocked" | "skipped" | "active" = "skipped";
  if (type === "agent") {
    status = "active";
  } else if (result) {
    status = result.blocked ? "blocked" : "passed";
  }

  return (
    <div className={`trace-step trace-step-${status}`}>
      <div className="trace-step-header">
        <span className="trace-step-label">{label}</span>
        <span className={`trace-step-status status-${status}`}>
          {status === "passed" && "✓ Passed"}
          {status === "blocked" && "✗ Blocked"}
          {status === "skipped" && "— Skipped"}
          {status === "active" && (model || "Active")}
        </span>
      </div>
      {result && result.rails_triggered.length > 0 && (
        <div className="trace-step-rails">
          {result.rails_triggered.map((rail, i) => (
            <span key={i} className="rail-chip">{rail}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default AgentTestingPage;
