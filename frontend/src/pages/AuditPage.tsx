import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AgentSummary } from "../types";
import "./AuditPage.css";

interface AuditEntry {
  timestamp: string;
  agent_id: string;
  config_id: string;
  config_name: string;
  message: string;
  result: string;
  latency_ms: number;
  rails_triggered: string[];
}

interface AuditSummary {
  total_evaluations: number;
  total_blocked: number;
  total_passed: number;
  block_rate: number;
  avg_latency_ms: number;
  compliance_score: number;
  by_agent: Record<string, { total: number; blocked: number; passed: number }>;
  by_config: Record<string, { total: number; blocked: number; passed: number }>;
}

function AuditPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [filterAgent, setFilterAgent] = useState("");
  const [filterResult, setFilterResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listAgents().then(setAgents).catch(() => {});
    loadData();
  }, []);

  useEffect(() => {
    loadData();
  }, [filterAgent, filterResult]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [entriesRes, summaryRes] = await Promise.all([
        api.getAuditEntries({
          agent_id: filterAgent || undefined,
          result: filterResult || undefined,
          limit: 200,
        }),
        api.getAuditSummary(filterAgent || undefined),
      ]);
      setEntries(entriesRes.entries);
      setTotal(entriesRes.total);
      setSummary(summaryRes);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    try {
      const res = await fetch("/api/audit/export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit_log.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleClear() {
    if (!window.confirm("Are you sure you want to clear the audit log? This cannot be undone.")) return;
    try {
      await api.clearAudit();
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function formatTimestamp(ts: string): string {
    try {
      const d = new Date(ts);
      return d.toLocaleString();
    } catch {
      return ts;
    }
  }

  function getAgentName(agentId: string): string {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name || agentId;
  }

  return (
    <div className="audit-page">
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p className="page-subtitle">
            Track every guardrail evaluation for compliance and analysis.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={handleExport}>
            Export CSV
          </button>
          <button className="btn btn-sm btn-danger" onClick={handleClear}>
            Clear Log
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {summary && (
        <div className="audit-summary">
          <div className="summary-stat">
            <span className="stat-value">{summary.total_evaluations}</span>
            <span className="stat-label">Total Evaluations</span>
          </div>
          <div className="summary-stat blocked">
            <span className="stat-value">{summary.block_rate}%</span>
            <span className="stat-label">Block Rate</span>
          </div>
          <div className="summary-stat">
            <span className="stat-value">{summary.avg_latency_ms}ms</span>
            <span className="stat-label">Avg Latency</span>
          </div>
          <div className="summary-stat passed">
            <span className="stat-value">{summary.compliance_score}%</span>
            <span className="stat-label">Compliance Score</span>
          </div>
        </div>
      )}

      <div className="audit-filters">
        <div className="form-group">
          <label htmlFor="audit-agent">Agent</label>
          <select
            id="audit-agent"
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
          >
            <option value="">All Agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="audit-result">Result</label>
          <select
            id="audit-result"
            value={filterResult}
            onChange={(e) => setFilterResult(e.target.value)}
          >
            <option value="">All</option>
            <option value="blocked">Blocked</option>
            <option value="passed">Passed</option>
          </select>
        </div>

        <div className="filter-info">
          {loading ? "Loading..." : `${total} entries`}
        </div>
      </div>

      <div className="audit-table">
        <div className="audit-row header">
          <span>Timestamp</span>
          <span>Agent</span>
          <span>Config</span>
          <span>Message</span>
          <span>Result</span>
          <span>Latency</span>
        </div>
        {entries.length === 0 && !loading && (
          <div className="audit-empty">No audit entries found.</div>
        )}
        {entries.map((entry, i) => (
          <div key={i} className={`audit-row ${entry.result}`}>
            <span className="audit-ts">{formatTimestamp(entry.timestamp)}</span>
            <span className="audit-agent">{getAgentName(entry.agent_id)}</span>
            <span className="audit-config">{entry.config_name}</span>
            <span className="audit-message" title={entry.message}>
              {entry.message}
            </span>
            <span className={`audit-result-badge ${entry.result}`}>
              {entry.result.toUpperCase()}
            </span>
            <span className="audit-latency">{entry.latency_ms}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AuditPage;
