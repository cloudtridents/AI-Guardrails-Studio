import { useEffect, useState } from "react";
import { api } from "../api/client";
import type {
  DecisionBackend,
  ClassifyResponse,
  ClassifierCategoryResult,
} from "../types";
import "./ClassifierPage.css";

interface CategoryConfig {
  labels: string[];
  threshold: number;
  action: string;
  description: string;
}

interface BackendStatus {
  backend: DecisionBackend;
  available_backends: DecisionBackend[];
  strands: { url: string; model: string; available: boolean; error?: string };
}

const BACKEND_LABELS: Record<DecisionBackend, string> = {
  bert: "DistilBERT (local)",
  strands: "strands-decider",
  combined: "Combined (max)",
};

const BACKEND_HINTS: Record<DecisionBackend, string> = {
  bert: "Local zero-shot classifier. Fast (~10-50ms), no API calls.",
  strands: "Calibrated yes/no decision model served over HTTP.",
  combined: "Runs both backends; a category triggers if either crosses its threshold.",
};

function ClassifierPage() {
  const [categories, setCategories] = useState<Record<string, CategoryConfig>>({});
  const [modelInfo, setModelInfo] = useState<any>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [backend, setBackend] = useState<DecisionBackend>("bert");
  const [switchingBackend, setSwitchingBackend] = useState(false);
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<ClassifyResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New category form
  const [newName, setNewName] = useState("");
  const [newLabels, setNewLabels] = useState("");
  const [newThreshold, setNewThreshold] = useState(0.7);
  const [newAction, setNewAction] = useState("block");
  const [newDescription, setNewDescription] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [cats, model, backendInfo] = await Promise.all([
        api.getClassifierCategories(),
        api.getClassifierModel(),
        api.getDecisionBackend(),
      ]);
      setCategories(cats);
      setModelInfo(model);
      setBackendStatus(backendInfo);
      setBackend(backendInfo.backend);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBackendChange(next: DecisionBackend) {
    if (next === backend) return;
    setSwitchingBackend(true);
    setError("");
    try {
      await api.setDecisionBackend(next);
      setBackend(next);
      // Refresh backend availability + model info for the new backend
      const [model, backendInfo] = await Promise.all([
        api.getClassifierModel(),
        api.getDecisionBackend(),
      ]);
      setModelInfo(model);
      setBackendStatus(backendInfo);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSwitchingBackend(false);
    }
  }

  async function handleTest() {
    if (!testInput.trim()) return;
    setTesting(true);
    setError("");
    try {
      const result = await api.classifyText(testInput, backend);
      setTestResult(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  }

  async function handleAddCategory() {
    if (!newName.trim() || !newLabels.trim()) return;
    try {
      await api.addClassifierCategory(newName, {
        labels: newLabels.split(",").map((l) => l.trim()).filter(Boolean),
        threshold: newThreshold,
        action: newAction,
        description: newDescription,
      });
      setNewName("");
      setNewLabels("");
      setNewThreshold(0.7);
      setNewAction("block");
      setNewDescription("");
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteCategory(name: string) {
    if (!confirm(`Delete category "${name}"?`)) return;
    try {
      await api.deleteClassifierCategory(name);
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function renderScoreBreakdown(r: ClassifierCategoryResult) {
    // Only show the per-backend split when combined mode is active and we have
    // both scores. In single-backend modes the primary score already says it.
    if (backend !== "combined") return null;
    if (r.bert_score === undefined && r.strands_score === undefined) return null;
    return (
      <div className="score-breakdown">
        <span className="breakdown-item">
          BERT: {((r.bert_score ?? 0) * 100).toFixed(1)}%
        </span>
        <span className="breakdown-item">
          strands: {((r.strands_score ?? 0) * 100).toFixed(1)}%
        </span>
      </div>
    );
  }

  if (loading) return <div className="loading">Loading classifier...</div>;

  const strandsAvailable = backendStatus?.strands?.available ?? false;

  return (
    <div className="classifier-page">
      <div className="page-header">
        <div>
          <h1>Local Classifier</h1>
          <p className="page-subtitle">
            Fast guardrail pre-filtering. Choose a decision backend and test
            messages against configurable categories.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Decision Backend Selector */}
      {backendStatus && (
        <div className="backend-card">
          <div className="backend-header">
            <h2>Decision Backend</h2>
            {switchingBackend && <span className="backend-switching">Switching…</span>}
          </div>
          <div className="backend-options">
            {backendStatus.available_backends.map((b) => (
              <button
                key={b}
                className={`backend-option ${backend === b ? "active" : ""}`}
                onClick={() => handleBackendChange(b)}
                disabled={switchingBackend}
              >
                <span className="backend-option-name">{BACKEND_LABELS[b]}</span>
                <span className="backend-option-hint">{BACKEND_HINTS[b]}</span>
              </button>
            ))}
          </div>
          {(backend === "strands" || backend === "combined") && (
            <div className={`strands-status ${strandsAvailable ? "ok" : "down"}`}>
              <span className="strands-dot" />
              <span>
                strands-decider{" "}
                {strandsAvailable ? "reachable" : "unavailable"} at{" "}
                <code>{backendStatus.strands.url}</code>
              </span>
              {!strandsAvailable && backendStatus.strands.error && (
                <span className="strands-error">{backendStatus.strands.error}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Model Info */}
      {modelInfo && (
        <div className="model-info-card">
          <div className="model-info-grid">
            <div className="info-item">
              <span className="info-label">Active Backend</span>
              <span className="info-value">
                {BACKEND_LABELS[(modelInfo.decision_backend as DecisionBackend) ?? "bert"]}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">BERT Model</span>
              <span className="info-value">{modelInfo.bert?.model_name ?? modelInfo.model_name}</span>
            </div>
            <div className="info-item">
              <span className="info-label">strands Model</span>
              <span className="info-value">{modelInfo.strands?.model_name ?? "—"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">BERT Status</span>
              <span className="info-value status-badge">
                {(modelInfo.bert?.loaded ?? modelInfo.loaded) ? "✓ Loaded" : "Not loaded (lazy)"}
              </span>
            </div>
          </div>
          <p className="model-desc">
            {modelInfo.bert?.description ?? modelInfo.description}
          </p>
        </div>
      )}

      {/* Test Interface */}
      <div className="test-section">
        <h2>Test Classifier</h2>
        <div className="test-input-row">
          <textarea
            className="test-input"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="Type a message to classify... e.g. 'How do I hack into a system?'"
            rows={3}
          />
          <button
            className="btn btn-primary test-btn"
            onClick={handleTest}
            disabled={testing || !testInput.trim()}
          >
            {testing ? "Classifying..." : "Classify"}
          </button>
        </div>

        {testResult && (
          <div className="test-results">
            <div className="result-header">
              <span className={`result-verdict ${testResult.blocked ? "blocked" : testResult.flagged ? "flagged" : "passed"}`}>
                {testResult.blocked ? "🚫 BLOCKED" : testResult.flagged ? "⚠️ FLAGGED" : "✅ PASSED"}
              </span>
              <span className="result-latency">{testResult.latency_ms}ms</span>
              <span className="result-backend">via {BACKEND_LABELS[testResult.backend]}</span>
              {testResult.strands_latency_ms !== undefined && (
                <span className="result-latency">strands: {testResult.strands_latency_ms}ms</span>
              )}
              {testResult.triggered_categories.length > 0 && (
                <span className="result-triggers">
                  Triggered: {testResult.triggered_categories.join(", ")}
                </span>
              )}
            </div>

            {testResult.strands_error && (
              <div className="strands-inline-error">
                strands-decider error: {testResult.strands_error}
              </div>
            )}

            <div className="scores-grid">
              {testResult.results.map((r) => (
                <div key={r.category} className={`score-row ${r.triggered ? "triggered" : ""}`}>
                  <div className="score-header">
                    <span className="score-category">{r.category}</span>
                    <span className={`score-action action-${r.action}`}>{r.action}</span>
                  </div>
                  <div className="score-bar-container">
                    <div
                      className={`score-bar ${r.triggered ? "bar-triggered" : ""}`}
                      style={{ width: `${r.score * 100}%` }}
                    />
                    <div className="score-threshold" style={{ left: `${r.threshold * 100}%` }} />
                  </div>
                  <div className="score-values">
                    <span className="score-value">{(r.score * 100).toFixed(1)}%</span>
                    <span className="score-thresh">threshold: {(r.threshold * 100).toFixed(0)}%</span>
                  </div>
                  {renderScoreBreakdown(r)}
                </div>
              ))}
            </div>

            {/* Performance Metrics */}
            {testResult.performance ? (
              <PerformanceView performance={testResult.performance as PerformanceMetrics} />
            ) : null}
          </div>
        )}
      </div>

      {/* Categories Configuration */}
      <div className="categories-section">
        <h2>Categories ({Object.keys(categories).length})</h2>
        <p className="section-hint">
          Each category defines labels that the classifier checks against, a confidence threshold, and an action (block, flag, or escalate).
        </p>

        <div className="categories-grid">
          {Object.entries(categories).map(([name, config]) => (
            <div key={name} className="category-card">
              <div className="category-header">
                <span className="category-name">{name}</span>
                <span className={`category-action action-${config.action}`}>{config.action}</span>
              </div>
              <p className="category-desc">{config.description}</p>
              <div className="category-labels">
                {config.labels.map((label, i) => (
                  <span key={i} className="label-chip">{label}</span>
                ))}
              </div>
              <div className="category-footer">
                <span className="category-threshold">
                  Threshold: {(config.threshold * 100).toFixed(0)}%
                </span>
                <button
                  className="btn-icon-sm"
                  onClick={() => handleDeleteCategory(name)}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add New Category */}
        <div className="add-category">
          <h3>Add Custom Category</h3>
          <div className="add-form">
            <div className="form-row">
              <div className="form-group">
                <label>Name</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my_category" />
              </div>
              <div className="form-group">
                <label>Action</label>
                <select value={newAction} onChange={(e) => setNewAction(e.target.value)}>
                  <option value="block">Block</option>
                  <option value="flag">Flag</option>
                  <option value="escalate">Escalate</option>
                </select>
              </div>
              <div className="form-group">
                <label>Threshold: {(newThreshold * 100).toFixed(0)}%</label>
                <input type="range" min="0" max="1" step="0.05" value={newThreshold} onChange={(e) => setNewThreshold(parseFloat(e.target.value))} />
              </div>
            </div>
            <div className="form-group">
              <label>Labels (comma-separated)</label>
              <input type="text" value={newLabels} onChange={(e) => setNewLabels(e.target.value)} placeholder="label 1, label 2, label 3" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input type="text" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="What this category detects" />
            </div>
            <button className="btn btn-primary" onClick={handleAddCategory} disabled={!newName.trim() || !newLabels.trim()}>
              Add Category
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Performance Metrics subview ──────────────────────────────────────────────

interface PerformanceMetrics {
  timing: { inference_ms: number; total_ms: number; overhead_ms: number };
  system: {
    cpu_usage_percent: number;
    memory_usage_percent: number;
    memory_used_mb: number;
    memory_total_mb: number;
    process_cpu_percent: number;
    process_memory_mb: number;
  };
  device: { gpu_available: boolean; device_type: "cpu" | "gpu" };
  efficiency: {
    tokens_processed: number;
    throughput_tokens_per_sec: number;
    latency_per_token_ms: number;
  };
}

function PerformanceView({ performance }: { performance: PerformanceMetrics }) {
  return (
    <div className="performance-metrics">
      <h3>Performance Metrics</h3>
      <div className="metrics-grid">
        <div className="metrics-section">
          <h4>Timing</h4>
          <div className="metric-row">
            <span className="metric-label">Inference Time</span>
            <span className="metric-value">{performance.timing.inference_ms.toFixed(2)}ms</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Total Time</span>
            <span className="metric-value">{performance.timing.total_ms.toFixed(2)}ms</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Overhead</span>
            <span className="metric-value">{performance.timing.overhead_ms.toFixed(2)}ms</span>
          </div>
        </div>

        <div className="metrics-section">
          <h4>System Resources</h4>
          <div className="metric-row">
            <span className="metric-label">CPU Usage</span>
            <span className="metric-value">{performance.system.cpu_usage_percent.toFixed(1)}%</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Memory Usage</span>
            <span className="metric-value">{performance.system.memory_usage_percent.toFixed(1)}%</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Memory Used</span>
            <span className="metric-value">{performance.system.memory_used_mb.toFixed(0)}MB / {performance.system.memory_total_mb.toFixed(0)}MB</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Process CPU</span>
            <span className="metric-value">{performance.system.process_cpu_percent.toFixed(1)}%</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Process Memory</span>
            <span className="metric-value">{performance.system.process_memory_mb.toFixed(1)}MB</span>
          </div>
        </div>

        <div className="metrics-section">
          <h4>Device</h4>
          <div className="metric-row">
            <span className="metric-label">Device Type</span>
            <span className="metric-value">{performance.device.device_type.toUpperCase()}</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">GPU Available</span>
            <span className="metric-value">{performance.device.gpu_available ? "✓ Yes" : "✗ No"}</span>
          </div>
        </div>

        <div className="metrics-section">
          <h4>Efficiency</h4>
          <div className="metric-row">
            <span className="metric-label">Tokens Processed</span>
            <span className="metric-value">{performance.efficiency.tokens_processed}</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Throughput</span>
            <span className="metric-value">{performance.efficiency.throughput_tokens_per_sec.toFixed(1)} tok/s</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Latency per Token</span>
            <span className="metric-value">{performance.efficiency.latency_per_token_ms.toFixed(2)}ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClassifierPage;
