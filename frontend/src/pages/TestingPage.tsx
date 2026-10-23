import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type { ChatMessage, ChatResponse, GuardrailConfig } from "../types";
import "./TestingPage.css";

interface DisplayMessage extends ChatMessage {
  meta?: {
    guardrails_triggered: string[];
    blocked: boolean;
    log: string[];
  };
}

function TestingPage() {
  const { id } = useParams();
  const [config, setConfig] = useState<GuardrailConfig | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) loadConfig(id);
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadConfig(configId: string) {
    try {
      setConfigLoading(true);
      const data = await api.getConfig(configId);
      setConfig(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConfigLoading(false);
    }
  }

  async function handleSend() {
    if (!input.trim() || !id || loading) return;

    const userMessage: DisplayMessage = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError("");

    try {
      const history: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response: ChatResponse = await api.sendMessage({
        config_id: id,
        message: input,
        history,
      });

      const assistantMessage: DisplayMessage = {
        role: "assistant",
        content: response.response,
        meta: {
          guardrails_triggered: response.guardrails_triggered,
          blocked: response.blocked,
          log: response.log,
        },
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleClearChat() {
    setMessages([]);
    setShowLog(null);
  }

  if (configLoading) return <div className="loading">Loading...</div>;
  if (!config) return <div className="error-banner">Configuration not found</div>;

  return (
    <div className="testing-page">
      <div className="testing-header">
        <div>
          <h1>Test: {config.name}</h1>
          <p className="page-subtitle">
            Send messages to test how your guardrails respond.
          </p>
        </div>
        <div className="testing-header-actions">
          <Link to={`/configs/${id}`} className="btn btn-secondary">
            Edit Config
          </Link>
          <button className="btn btn-secondary" onClick={handleClearChat}>
            Clear Chat
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="chat-container">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              <p>Start a conversation to test your guardrails.</p>
              <p className="hint">
                Try sending messages that should be blocked by your rules.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`chat-message ${msg.role} ${msg.meta?.blocked ? "blocked" : ""}`}
            >
              <div className="message-role">
                {msg.role === "user" ? "You" : "Bot"}
              </div>
              <div className="message-content">{msg.content}</div>
              {msg.meta && (
                <div className="message-meta">
                  {msg.meta.blocked && (
                    <span className="badge badge-blocked">Blocked</span>
                  )}
                  {msg.meta.guardrails_triggered.length > 0 && (
                    <span className="badge badge-triggered">
                      Rails: {msg.meta.guardrails_triggered.join(", ")}
                    </span>
                  )}
                  <button
                    className="log-toggle"
                    onClick={() => setShowLog(showLog === i ? null : i)}
                    aria-expanded={showLog === i}
                  >
                    {showLog === i ? "Hide Log" : "Show Log"}
                  </button>
                </div>
              )}
              {showLog === i && msg.meta && (
                <div className="message-log">
                  {msg.meta.log.map((entry, j) => (
                    <div key={j} className="log-entry">
                      {entry}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="chat-message assistant loading-msg">
              <div className="message-role">Bot</div>
              <div className="message-content typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
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
            placeholder="Type a message to test guardrails... (Enter to send)"
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
    </div>
  );
}

export default TestingPage;
