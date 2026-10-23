import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import mermaid from "mermaid";
import { api } from "../api/client";
import type { AgentSummary } from "../types";
import "./GraphPage.css";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    primaryColor: "#1e293b",
    primaryTextColor: "#f0f4f8",
    primaryBorderColor: "#76b900",
    lineColor: "#6b7280",
    secondaryColor: "#1e293b",
    tertiaryColor: "#1a2332",
    background: "transparent",
    mainBkg: "#1e293b",
    nodeBorder: "#4b5563",
    clusterBkg: "#111827",
    titleColor: "#f0f4f8",
    edgeLabelBackground: "transparent",
    nodeTextColor: "#f0f4f8",
    labelBoxBorderColor: "#374151",
    labelBoxBkgColor: "#1e293b",
    labelTextColor: "#f0f4f8",
    fontFamily: "inherit",
    fontSize: "14px",
  },
});

// ─── Types ──────────────────────────────────────────────────────────────────────

interface PipelineStep {
  step: number;
  label: string;
  done?: boolean;
  blocked?: boolean;
  error?: boolean;
}

interface ExecutionRun {
  id: string;
  message: string;
  timestamp: number;
  steps: PipelineStep[];
  result: "passed" | "blocked" | "error";
  latency_ms: number;
  response?: string;
  reasoning?: string[];
  blockedBy?: string;
}

interface NodeHealth {
  id: string;
  status: "healthy" | "warning" | "error";
  avgLatency: number;
  blockRate: number;
  totalRuns: number;
}

interface AgentGraphInfo {
  agent_name: string;
  provider: string;
  model: string;
  input_rails: string[];
  output_rails: string[];
}

// ─── Component ──────────────────────────────────────────────────────────────────

function GraphPage() {
  const { id } = useParams();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>(id || "");
  const [mermaidCode, setMermaidCode] = useState("");
  const [agentInfo, setAgentInfo] = useState<AgentGraphInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const diagramRef = useRef<HTMLDivElement>(null);

  // Inline test panel
  const [testInput, setTestInput] = useState("");
  const [testing, setTesting] = useState(false);

  // Live execution state
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [executionSteps, setExecutionSteps] = useState<PipelineStep[]>([]);
  const [executionResult, setExecutionResult] = useState<"idle" | "running" | "passed" | "blocked" | "error">("idle");

  // Execution history
  const [execHistory, setExecHistory] = useState<ExecutionRun[]>([]);
  const [replayingRun, setReplayingRun] = useState<string | null>(null);

  // Node health
  const [nodeHealth, setNodeHealth] = useState<NodeHealth[]>([]);

  // Inspect panel
  const [inspectedNode, setInspectedNode] = useState<string | null>(null);

  // ─── Load agents ───────────────────────────────────────────────────────────

  useEffect(() => {
    api.listAgents().then((list) => {
      setAgents(list);
      if (!selectedAgent && list.length > 0) {
        setSelectedAgent(list[0].id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      loadAgentGraph(selectedAgent);
      loadHealthMetrics();
    }
  }, [selectedAgent]);

  useEffect(() => {
    renderDiagram();
  }, [mermaidCode, activeStep, executionResult]);

  // ─── Load graph ────────────────────────────────────────────────────────────

  async function loadAgentGraph(agentId: string) {
    try {
      setLoading(true);
      const data = await api.getAgentGraph(agentId);
      setMermaidCode(data.mermaid);
      setAgentInfo(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ─── Health metrics from real data ─────────────────────────────────────────

  async function loadHealthMetrics() {
    try {
      const metrics = await api.getMetrics();
      if (metrics && metrics.recent_events) {
        const events = metrics.recent_events || [];
        const inputEvents = events.filter((e: any) => e.stage === "input");
        const outputEvents = events.filter((e: any) => e.stage === "output");

        const health: NodeHealth[] = [];

        if (inputEvents.length > 0) {
          const blocked = inputEvents.filter((e: any) => e.blocked).length;
          const avgLat = inputEvents.reduce((s: number, e: any) => s + (e.latency_ms || 0), 0) / inputEvents.length;
          health.push({
            id: "input_guardrails",
            status: avgLat > 2000 ? "warning" : blocked / inputEvents.length > 0.5 ? "error" : "healthy",
            avgLatency: Math.round(avgLat),
            blockRate: Math.round((blocked / inputEvents.length) * 100),
            totalRuns: inputEvents.length,
          });
        }

        if (outputEvents.length > 0) {
          const blocked = outputEvents.filter((e: any) => e.blocked).length;
          const avgLat = outputEvents.reduce((s: number, e: any) => s + (e.latency_ms || 0), 0) / outputEvents.length;
          health.push({
            id: "output_guardrails",
            status: avgLat > 2000 ? "warning" : blocked / outputEvents.length > 0.5 ? "error" : "healthy",
            avgLatency: Math.round(avgLat),
            blockRate: Math.round((blocked / outputEvents.length) * 100),
            totalRuns: outputEvents.length,
          });
        }

        setNodeHealth(health);
      }
    } catch {
      // Metrics not critical
    }
  }

  // ─── Live execution (inline test) ─────────────────────────────────────────

  async function runInlineTest() {
    if (!testInput.trim() || !selectedAgent || testing) return;

    setTesting(true);
    setExecutionResult("running");
    setExecutionSteps([]);
    setActiveStep(0);
    setInspectedNode(null);

    const startTime = Date.now();
    const steps: PipelineStep[] = [];

    const controller = api.chatWithAgentStream(
      { agent_id: selectedAgent, message: testInput, history: [], guardrails_enabled: true },
      (status) => {
        steps.push(status);
        setExecutionSteps([...steps]);
        setActiveStep(status.step);

        if (status.blocked) {
          setExecutionResult("blocked");
        } else if (status.error) {
          setExecutionResult("error");
        }
      },
      (complete) => {
        const elapsed = Date.now() - startTime;
        const result: "passed" | "blocked" | "error" = complete.blocked ? "blocked" : "passed";
        setExecutionResult(result);
        setActiveStep(null);
        setTesting(false);

        // Determine which guardrail blocked (from reasoning or steps)
        let blockedBy: string | undefined;
        if (complete.blocked && complete.agent_reasoning) {
          const blockLine = complete.agent_reasoning.find((r: string) =>
            r.toLowerCase().includes("blocked by")
          );
          if (blockLine) {
            blockedBy = blockLine;
          }
        }

        // Add to history
        const run: ExecutionRun = {
          id: Date.now().toString(),
          message: testInput,
          timestamp: Date.now(),
          steps,
          result,
          latency_ms: elapsed,
          response: complete.response,
          reasoning: complete.agent_reasoning,
          blockedBy,
        };
        setExecHistory((prev) => [run, ...prev].slice(0, 20));

        // Reset visual after 3s
        setTimeout(() => {
          setExecutionResult("idle");
          setExecutionSteps([]);
        }, 4000);
      },
      (err) => {
        setExecutionResult("error");
        setTesting(false);
        setActiveStep(null);
      }
    );
  }

  // ─── Replay execution ─────────────────────────────────────────────────────

  async function replayExecution(run: ExecutionRun) {
    setReplayingRun(run.id);
    setExecutionSteps([]);
    setExecutionResult("running");

    for (let i = 0; i < run.steps.length; i++) {
      await new Promise((r) => setTimeout(r, 400));
      setActiveStep(run.steps[i].step);
      setExecutionSteps(run.steps.slice(0, i + 1));
    }

    await new Promise((r) => setTimeout(r, 500));
    setExecutionResult(run.result);
    setActiveStep(null);
    setReplayingRun(null);

    setTimeout(() => {
      setExecutionResult("idle");
      setExecutionSteps([]);
    }, 3000);
  }

  // ─── Render diagram with live state ────────────────────────────────────────

  async function renderDiagram() {
    if (!diagramRef.current || !mermaidCode) return;
    try {
      // Generate unique ID to avoid mermaid caching
      const renderId = `graph-${Date.now()}`;
      const { svg } = await mermaid.render(renderId, mermaidCode);
      diagramRef.current.innerHTML = svg;

      const svgEl = diagramRef.current.querySelector("svg");
      if (svgEl) {
        // Fix node backgrounds
        svgEl.querySelectorAll(".node rect, .node circle, .node polygon").forEach((el) => {
          const htmlEl = el as SVGElement;
          const currentFill = htmlEl.getAttribute("fill") || "";
          if (!currentFill || currentFill === "#fff" || currentFill === "#ffffff" ||
              currentFill === "white" || currentFill === "#ECECFF" || currentFill === "#ececff" ||
              currentFill.startsWith("rgb(255") || currentFill.startsWith("rgb(236")) {
            htmlEl.setAttribute("fill", "#1e293b");
            htmlEl.setAttribute("stroke", "#4b5563");
          }
        });

        // Fix text colors
        svgEl.querySelectorAll("foreignObject div, foreignObject span, foreignObject p").forEach((el) => {
          const htmlEl = el as HTMLElement;
          htmlEl.style.color = "#f0f4f8";
          htmlEl.style.backgroundColor = "transparent";
          htmlEl.style.background = "transparent";
        });

        svgEl.querySelectorAll(".edgeLabel rect, .edgeLabel path").forEach((el) => {
          (el as SVGElement).setAttribute("fill", "transparent");
          (el as SVGElement).setAttribute("stroke", "none");
        });

        svgEl.style.backgroundColor = "transparent";

        // ─── Live execution highlighting ─────────────────────────────────
        if (executionResult !== "idle") {
          const nodes = svgEl.querySelectorAll(".node");
          nodes.forEach((node, idx) => {
            const rect = node.querySelector("rect, polygon, circle") as SVGElement;
            if (!rect) return;

            if (activeStep !== null && idx === activeStep + 1) {
              // Active node — pulsing glow
              rect.setAttribute("stroke", "#fbbf24");
              rect.setAttribute("stroke-width", "3");
              rect.classList.add("node-active-pulse");
            } else if (executionResult === "blocked" && idx === (activeStep ?? 0) + 1) {
              rect.setAttribute("stroke", "#ef4444");
              rect.setAttribute("stroke-width", "3");
              rect.setAttribute("fill", "rgba(239, 68, 68, 0.15)");
            }
          });

          // Highlight passed steps
          executionSteps.forEach((step) => {
            if (step.done) {
              const nodes2 = svgEl.querySelectorAll(".node");
              const targetNode = nodes2[step.step + 1];
              if (targetNode) {
                const rect2 = targetNode.querySelector("rect, polygon, circle") as SVGElement;
                if (rect2) {
                  rect2.setAttribute("stroke", "#10b981");
                  rect2.setAttribute("stroke-width", "2.5");
                }
              }
            }
          });
        }

        // ─── Health indicators ───────────────────────────────────────────
        if (nodeHealth.length > 0 && executionResult === "idle") {
          const nodes = svgEl.querySelectorAll(".node");
          nodeHealth.forEach((h) => {
            // Find the node that matches
            const idx = h.id === "input_guardrails" ? 1 : h.id === "output_guardrails" ? 3 : -1;
            if (idx >= 0 && nodes[idx]) {
              const rect = nodes[idx].querySelector("rect, polygon") as SVGGraphicsElement | null;
              if (rect) {
                const bbox = rect.getBBox();
                const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                dot.setAttribute("cx", String(bbox.x + bbox.width - 8));
                dot.setAttribute("cy", String(bbox.y + 8));
                dot.setAttribute("r", "5");
                dot.setAttribute("fill", h.status === "healthy" ? "#10b981" : h.status === "warning" ? "#f59e0b" : "#ef4444");
                dot.setAttribute("class", "health-dot");
                nodes[idx].appendChild(dot);
              }
            }
          });
        }

        // ─── Latency annotations ─────────────────────────────────────────
        if (nodeHealth.length > 0 && executionResult === "idle") {
          const edgeLabels = svgEl.querySelectorAll(".edgeLabel");
          nodeHealth.forEach((h, i) => {
            const targetLabel = edgeLabels[i];
            if (targetLabel && h.avgLatency > 0) {
              const text = targetLabel.querySelector("foreignObject div, foreignObject span");
              if (text) {
                const existing = text.textContent || "";
                if (!existing.includes("ms")) {
                  text.textContent = `${existing} ~${h.avgLatency}ms`;
                }
              }
            }
          });
        }

        // ─── Click-to-inspect ────────────────────────────────────────────
        const allNodes = svgEl.querySelectorAll(".node");
        allNodes.forEach((node, idx) => {
          (node as SVGElement).style.cursor = "pointer";
          node.addEventListener("click", () => {
            const nodeNames = ["start", "input_guardrails", "agent", "output_guardrails", "end"];
            setInspectedNode(nodeNames[idx] || `node_${idx}`);
          });
        });
      }
    } catch (e: any) {
      if (diagramRef.current) {
        diagramRef.current.innerHTML = `<pre class="mermaid-fallback">${mermaidCode}</pre>`;
      }
    }
  }

  // ─── Get inspect panel content ─────────────────────────────────────────────

  function getInspectContent() {
    if (!inspectedNode || !agentInfo) return null;

    const health = nodeHealth.find((h) => h.id === inspectedNode);

    if (inspectedNode === "agent") {
      return {
        title: agentInfo.agent_name,
        type: "LLM Agent",
        details: [
          { label: "Provider", value: agentInfo.provider },
          { label: "Model", value: agentInfo.model },
          { label: "Input Rails", value: agentInfo.input_rails.join(", ") || "None" },
          { label: "Output Rails", value: agentInfo.output_rails.join(", ") || "None" },
        ],
        health,
      };
    }

    if (inspectedNode === "input_guardrails") {
      return {
        title: "Input Guardrails",
        type: "Guardrail Chain",
        details: [
          { label: "Rails", value: agentInfo.input_rails.join(" → ") || "None" },
          { label: "Count", value: String(agentInfo.input_rails.length) },
          ...(health ? [
            { label: "Avg Latency", value: `${health.avgLatency}ms` },
            { label: "Block Rate", value: `${health.blockRate}%` },
            { label: "Total Runs", value: String(health.totalRuns) },
          ] : []),
        ],
        health,
      };
    }

    if (inspectedNode === "output_guardrails") {
      return {
        title: "Output Guardrails",
        type: "Guardrail Chain",
        details: [
          { label: "Rails", value: agentInfo.output_rails.join(" → ") || "None" },
          { label: "Count", value: String(agentInfo.output_rails.length) },
          ...(health ? [
            { label: "Avg Latency", value: `${health.avgLatency}ms` },
            { label: "Block Rate", value: `${health.blockRate}%` },
            { label: "Total Runs", value: String(health.totalRuns) },
          ] : []),
        ],
        health,
      };
    }

    return { title: inspectedNode, type: "Node", details: [], health: undefined };
  }

  const inspectContent = getInspectContent();

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="graph-page">
      <div className="page-header">
        <div>
          <h1>Pipeline Visualization</h1>
          <p className="page-subtitle">
            Interactive guardrail pipeline. Test messages, replay executions, and inspect nodes.
          </p>
        </div>
        <div className="graph-controls">
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="agent-select"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Inline Test Panel */}
      <div className="inline-test-panel">
        <div className="test-panel-input">
          <input
            type="text"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runInlineTest()}
            placeholder="Type a message to test the pipeline live..."
            disabled={testing}
          />
          <button
            onClick={runInlineTest}
            disabled={testing || !testInput.trim() || !selectedAgent}
            className="btn btn-primary"
          >
            {testing ? "Running..." : "Run Pipeline"}
          </button>
        </div>
        {executionResult !== "idle" && (
          <div className={`execution-status status-${executionResult}`}>
            <span className="status-dot" />
            <span className="status-text">
              {executionResult === "running" && "Pipeline executing..."}
              {executionResult === "passed" && "✓ Passed all guardrails"}
              {executionResult === "blocked" && "⛔ Blocked by guardrails"}
              {executionResult === "error" && "✗ Error occurred"}
            </span>
            {executionSteps.length > 0 && (
              <span className="status-steps">
                {executionSteps[executionSteps.length - 1]?.label}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Agent Info Bar */}
      {agentInfo && (
        <div className="agent-info-bar">
          <div className="info-item">
            <span className="info-label">Agent</span>
            <span className="info-value">{agentInfo.agent_name}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Provider</span>
            <span className="info-value">{agentInfo.provider}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Model</span>
            <span className="info-value">{agentInfo.model}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Input Rails</span>
            <span className="info-value">{agentInfo.input_rails.length || "None"}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Output Rails</span>
            <span className="info-value">{agentInfo.output_rails.length || "None"}</span>
          </div>
          {nodeHealth.map((h) => (
            <div className="info-item" key={h.id}>
              <span className="info-label">{h.id.replace("_", " ")} health</span>
              <span className={`info-value health-${h.status}`}>
                {h.status === "healthy" ? "● Healthy" : h.status === "warning" ? "● Warning" : "● Issues"}
                {h.avgLatency > 0 && ` (${h.avgLatency}ms avg)`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Main Content: Diagram + Inspect Panel */}
      <div className="graph-main-layout">
        {/* Diagram */}
        <div className="graph-container">
          {loading ? (
            <div className="graph-loading">Loading graph...</div>
          ) : (
            <div ref={diagramRef} className="mermaid-diagram" />
          )}
        </div>

        {/* Inspect Panel */}
        {inspectContent && (
          <div className="inspect-panel">
            <div className="inspect-header">
              <h3>{inspectContent.title}</h3>
              <button className="inspect-close" onClick={() => setInspectedNode(null)}>×</button>
            </div>
            <span className="inspect-type">{inspectContent.type}</span>
            {inspectContent.health && (
              <div className={`inspect-health health-${inspectContent.health.status}`}>
                {inspectContent.health.status === "healthy" ? "●" : inspectContent.health.status === "warning" ? "●" : "●"} {inspectContent.health.status}
              </div>
            )}
            <div className="inspect-details">
              {inspectContent.details.map((d, i) => (
                <div key={i} className="inspect-row">
                  <span className="inspect-label">{d.label}</span>
                  <span className="inspect-value">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Execution History */}
      {execHistory.length > 0 && (
        <div className="exec-history">
          <h3>Execution History</h3>
          <div className="exec-history-list">
            {execHistory.map((run) => (
              <div key={run.id} className={`exec-run exec-${run.result}`}>
                <div className="exec-run-header">
                  <span className="exec-run-result">
                    {run.result === "passed" ? "✓" : run.result === "blocked" ? "⛔" : "✗"}
                  </span>
                  <span className="exec-run-msg">{run.message}</span>
                  <span className="exec-run-time">{run.latency_ms}ms</span>
                </div>
                {/* Guardrail execution details */}
                {run.reasoning && run.reasoning.length > 0 && (
                  <div className="exec-run-reasoning">
                    {run.reasoning.map((r, i) => (
                      <span key={i} className={`reasoning-step ${r.toLowerCase().includes("blocked") ? "reasoning-blocked" : r.toLowerCase().includes("passed") ? "reasoning-passed" : ""}`}>
                        {r}
                      </span>
                    ))}
                  </div>
                )}
                {run.blockedBy && (
                  <div className="exec-run-blocked-by">
                    🛡️ {run.blockedBy}
                  </div>
                )}
                <div className="exec-run-actions">
                  <span className="exec-run-date">
                    {new Date(run.timestamp).toLocaleTimeString()}
                  </span>
                  <button
                    className="btn-sm"
                    onClick={() => replayExecution(run)}
                    disabled={replayingRun !== null}
                  >
                    {replayingRun === run.id ? "Replaying..." : "Replay"}
                  </button>
                </div>
                {run.response && !run.blockedBy && (
                  <div className="exec-run-response">
                    <span className="exec-run-response-label">🤖 LLM Response:</span>
                    <span className="exec-run-response-text">{run.response}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="graph-legend">
        <div className="legend-item">
          <span className="legend-color" style={{ background: "rgba(245, 158, 11, 0.3)", borderColor: "#f59e0b" }} />
          Input Guardrail
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: "rgba(118, 185, 0, 0.3)", borderColor: "#76b900" }} />
          LLM Agent
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: "rgba(96, 165, 250, 0.3)", borderColor: "#60a5fa" }} />
          Output Guardrail
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: "rgba(239, 68, 68, 0.3)", borderColor: "#ef4444" }} />
          Blocked
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: "rgba(16, 185, 129, 0.3)", borderColor: "#10b981" }} />
          Passed
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: "rgba(251, 191, 36, 0.3)", borderColor: "#fbbf24" }} />
          Active (executing)
        </div>
      </div>
    </div>
  );
}

export default GraphPage;
