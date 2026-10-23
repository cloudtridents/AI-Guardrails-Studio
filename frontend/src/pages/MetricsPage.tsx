import { useEffect, useState } from "react";
import { api } from "../api/client";
import "./MetricsPage.css";

interface MetricEvent {
  timestamp: number;
  agent_id: string;
  config_id: string | null;
  stage: string;
  blocked: boolean;
  rails_triggered: string[];
  latency_ms: number;
}

interface Metrics {
  total_requests: number;
  total_blocked: number;
  block_rate: number;
  avg_latency_ms: number;
  by_agent: Record<string, { count: number; blocked: number }>;
  by_stage: Record<string, { count: number; blocked: number }>;
  top_rails: Record<string, number>;
  recent_events: MetricEvent[];
}

interface TraceGroup {
  agent_id: string;
  timestamp: number;
  events: MetricEvent[];
  total_latency: number;
  was_blocked: boolean;
}

function groupEventsIntoTraces(events: MetricEvent[]): TraceGroup[] {
  // Group consecutive events by agent_id within a 10-second window
  const groups: TraceGroup[] = [];
  let current: TraceGroup | null = null;

  // Events are already sorted newest first — reverse to process chronologically
  const sorted = [...events].reverse();

  for (const event of sorted) {
    if (
      !current ||
      current.agent_id !== event.agent_id ||
      event.timestamp - current.timestamp > 10
    ) {
      current = {
        agent_id: event.agent_id,
        timestamp: event.timestamp,
        events: [],
        total_latency: 0,
        was_blocked: false,
      };
      groups.push(current);
    }
    current.events.push(event);
    current.total_latency += event.latency_ms;
    if (event.blocked) current.was_blocked = true;
  }

  return groups.reverse(); // Return newest first
}

function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTrace, setSelectedTrace] = useState<number | null>(null);

  useEffect(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadMetrics() {
    try {
      const data = await api.getMetrics();
      setMetrics(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    if (!confirm("Clear all metrics data?")) return;
    await api.clearMetrics();
    loadMetrics();
  }

  if (loading) return <div className="loading">Loading metrics...</div>;
  if (!metrics) return <div className="error-banner">Failed to load metrics</div>;

  const traces = groupEventsIntoTraces(metrics.recent_events);

  return (
    <div className="metrics-page">
      <div className="page-header">
        <div>
          <h1>Guardrail Metrics</h1>
          <p className="page-subtitle">Real-time statistics and execution traces.</p>
        </div>
        <button className="btn btn-secondary" onClick={handleClear}>
          Clear Metrics
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Summary Cards */}
      <div className="metrics-cards">
        <div className="metric-card">
          <div className="metric-value">{metrics.total_requests}</div>
          <div className="metric-label">Total Checks</div>
        </div>
        <div className="metric-card blocked">
          <div className="metric-value">{metrics.total_blocked}</div>
          <div className="metric-label">Blocked</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{metrics.block_rate}%</div>
          <div className="metric-label">Block Rate</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{metrics.avg_latency_ms}ms</div>
          <div className="metric-label">Avg Latency</div>
        </div>
      </div>

      {/* Timeline Trace Visualization */}
      <div className="metrics-section wide">
        <h3>Execution Timeline</h3>
        {traces.length === 0 ? (
          <p className="no-data">No traces recorded yet. Test an agent to generate data.</p>
        ) : (
          <div className="timeline-container">
            {traces.slice(0, 15).map((trace, i) => (
              <div
                key={i}
                className={`timeline-trace ${trace.was_blocked ? "trace-blocked" : "trace-passed"} ${selectedTrace === i ? "trace-selected" : ""}`}
                onClick={() => setSelectedTrace(selectedTrace === i ? null : i)}
              >
                <div className="timeline-header">
                  <span className="timeline-time">
                    {new Date(trace.timestamp * 1000).toLocaleTimeString()}
                  </span>
                  <span className="timeline-agent">{trace.agent_id}</span>
                  <span className={`timeline-result ${trace.was_blocked ? "blocked" : "passed"}`}>
                    {trace.was_blocked ? "BLOCKED" : "PASSED"}
                  </span>
                  <span className="timeline-latency">{trace.total_latency}ms total</span>
                </div>

                {/* Visual pipeline sequence */}
                <div className="timeline-sequence">
                  {trace.events.map((event, j) => {
                    const maxLatency = Math.max(...trace.events.map(e => e.latency_ms), 1);
                    const barWidth = Math.max(15, (event.latency_ms / maxLatency) * 100);
                    return (
                      <div key={j} className="sequence-step">
                        <div className="sequence-label">
                          <span className={`sequence-stage stage-${event.stage}`}>
                            {event.stage === "input" ? "🛡️ Input Rail" : "🔍 Output Rail"}
                          </span>
                        </div>
                        <div className="sequence-bar-container">
                          <div
                            className={`sequence-bar ${event.blocked ? "bar-blocked" : "bar-passed"}`}
                            style={{ width: `${barWidth}%` }}
                          >
                            <span className="bar-latency">{event.latency_ms}ms</span>
                          </div>
                        </div>
                        <div className="sequence-result">
                          {event.blocked ? (
                            <span className="result-icon blocked">✗</span>
                          ) : (
                            <span className="result-icon passed">✓</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Expanded details */}
                {selectedTrace === i && (
                  <div className="timeline-details">
                    {trace.events.map((event, j) => (
                      <div key={j} className="detail-row">
                        <span className="detail-stage">{event.stage}</span>
                        <span className="detail-config">{event.config_id || "—"}</span>
                        <span className="detail-latency">{event.latency_ms}ms</span>
                        {event.rails_triggered.length > 0 && (
                          <div className="detail-rails">
                            {event.rails_triggered.map((rail, k) => (
                              <span key={k} className="detail-rail-chip">{rail}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="metrics-grid">
        {/* By Stage */}
        <div className="metrics-section">
          <h3>By Stage</h3>
          <div className="metrics-table">
            <div className="table-row header">
              <span>Stage</span>
              <span>Checks</span>
              <span>Blocked</span>
              <span>Rate</span>
            </div>
            {Object.entries(metrics.by_stage).map(([stage, data]) => (
              <div key={stage} className="table-row">
                <span className="stage-name">{stage}</span>
                <span>{data.count}</span>
                <span className="blocked-count">{data.blocked}</span>
                <span>
                  {data.count > 0 ? Math.round((data.blocked / data.count) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Rails */}
        <div className="metrics-section">
          <h3>Top Triggered Rails</h3>
          {Object.keys(metrics.top_rails).length === 0 ? (
            <p className="no-data">No rails triggered yet</p>
          ) : (
            <div className="rails-list">
              {Object.entries(metrics.top_rails).map(([rail, count]) => (
                <div key={rail} className="rail-row">
                  <span className="rail-name">{rail}</span>
                  <span className="rail-count">{count}</span>
                  <div className="rail-bar">
                    <div
                      className="rail-bar-fill"
                      style={{
                        width: `${Math.min(100, (count / Math.max(...Object.values(metrics.top_rails))) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By Agent */}
        <div className="metrics-section">
          <h3>By Agent</h3>
          {Object.keys(metrics.by_agent).length === 0 ? (
            <p className="no-data">No agent data yet</p>
          ) : (
            <div className="metrics-table">
              <div className="table-row header">
                <span>Agent ID</span>
                <span>Checks</span>
                <span>Blocked</span>
              </div>
              {Object.entries(metrics.by_agent).map(([agentId, data]) => (
                <div key={agentId} className="table-row">
                  <span>{agentId}</span>
                  <span>{data.count}</span>
                  <span className="blocked-count">{data.blocked}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MetricsPage;
