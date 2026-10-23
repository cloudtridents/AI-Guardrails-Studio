import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type { AgentDefinition, ChatMessage, AgentChatResponse } from "../types";
import "./ComparisonPage.css";

interface ComparisonResult {
  input: string;
  withGuardrails: AgentChatResponse | null;
  withoutGuardrails: AgentChatResponse | null;
  loadingWith: boolean;
  loadingWithout: boolean;
}

function ComparisonPage() {
  const { id } = useParams();
  const [agent, setAgent] = useState<AgentDefinition | null>(null);
  const [input, setInput] = useState("");
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) loadAgent(id);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results]);

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

  async function handleSend() {
    if (!input.trim() || !id) return;

    const newResult: ComparisonResult = {
      input,
      withGuardrails: null,
      withoutGuardrails: null,
      loadingWith: true,
      loadingWithout: true,
    };
    const idx = results.length;
    setResults((prev) => [...prev, newResult]);
    setInput("");

    const history: ChatMessage[] = [];

    // Run both in parallel
    const [withResp, withoutResp] = await Promise.allSettled([
      api.chatWithAgent({
        agent_id: id,
        message: input,
        history,
        guardrails_enabled: true,
      }),
      api.chatWithAgent({
        agent_id: id,
        message: input,
        history,
        guardrails_enabled: false,
      }),
    ]);

    setResults((prev) => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        withGuardrails:
          withResp.status === "fulfilled" ? withResp.value : null,
        withoutGuardrails:
          withoutResp.status === "fulfilled" ? withoutResp.value : null,
        loadingWith: false,
        loadingWithout: false,
      };
      return updated;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (pageLoading) return <div className="loading">Loading...</div>;
  if (!agent) return <div className="error-banner">Agent not found</div>;

  return (
    <div className="comparison-page">
      <div className="page-header">
        <div>
          <h1>A/B Comparison: {agent.name}</h1>
          <p className="page-subtitle">
            Send the same message with and without guardrails to compare behavior.
          </p>
        </div>
        <div className="editor-header-actions">
          <Link to={`/agents/${id}/test`} className="btn btn-secondary">
            Normal Test
          </Link>
          <Link to={`/agents/${id}`} className="btn btn-secondary">
            Configure
          </Link>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="comparison-results">
        <div className="comparison-header-row">
          <div className="col-input">Input</div>
          <div className="col-with">With Guardrails</div>
          <div className="col-without">Without Guardrails</div>
        </div>

        {results.length === 0 && (
          <div className="comparison-empty">
            Send a message to see side-by-side results.
          </div>
        )}

        {results.map((r, i) => (
          <div key={i} className="comparison-row">
            <div className="col-input">
              <div className="comparison-message user-msg">{r.input}</div>
            </div>
            <div className="col-with">
              {r.loadingWith ? (
                <div className="comparison-loading">Processing...</div>
              ) : r.withGuardrails ? (
                <div
                  className={`comparison-message ${r.withGuardrails.blocked ? "blocked" : "passed"}`}
                >
                  <div className="response-text">{r.withGuardrails.response}</div>
                  <div className="response-meta">
                    {r.withGuardrails.blocked && (
                      <span className="badge badge-blocked">Blocked</span>
                    )}
                    {r.withGuardrails.input_guardrail?.rails_triggered.map(
                      (rail, j) => (
                        <span key={j} className="badge badge-input">
                          {rail}
                        </span>
                      )
                    )}
                    {r.withGuardrails.output_guardrail?.rails_triggered.map(
                      (rail, j) => (
                        <span key={j} className="badge badge-output">
                          {rail}
                        </span>
                      )
                    )}
                  </div>
                </div>
              ) : (
                <div className="comparison-error">Error</div>
              )}
            </div>
            <div className="col-without">
              {r.loadingWithout ? (
                <div className="comparison-loading">Processing...</div>
              ) : r.withoutGuardrails ? (
                <div className="comparison-message raw">
                  <div className="response-text">
                    {r.withoutGuardrails.response}
                  </div>
                  <div className="response-meta">
                    <span className="badge badge-noguard">No Guards</span>
                  </div>
                </div>
              ) : (
                <div className="comparison-error">Error</div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="comparison-input-bar">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message to compare... (Enter to send)"
          rows={2}
          aria-label="Comparison message input"
        />
        <button
          className="btn btn-primary send-btn"
          onClick={handleSend}
          disabled={!input.trim()}
        >
          Compare
        </button>
      </div>
    </div>
  );
}

export default ComparisonPage;
