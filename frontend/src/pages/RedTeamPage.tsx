import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "../api/client";
import type { AgentSummary } from "../types";
import "./RedTeamPage.css";

// ─── Types ───────────────────────────────────────────────────────────────────────

interface CategoryInfo {
  category: string;
  count: number;
  builtin_count: number;
  custom_count: number;
  description: string;
  is_custom: boolean;
}

interface TestResult {
  prompt: string;
  category: string;
  blocked: boolean;
  response: string;
  latency_ms: number;
  rails_triggered: string[];
}

interface CategoryResult {
  total: number;
  blocked: number;
  passed: number;
  block_rate: number;
  results: TestResult[];
}

interface TriageData {
  status: string;
  severity: string;
  notes: string;
}

interface RedTeamReport {
  id: string;
  timestamp: string;
  agent_id: string;
  agent_name: string;
  categories: string[];
  overall_score: number;
  total_tests: number;
  total_blocked: number;
  total_passed: number;
  total_time_ms: number;
  category_results: Record<string, CategoryResult>;
  failed_tests: TestResult[];
  status: string;
  triage_data: (TriageData | null)[];
}

interface RunSummary {
  id: string;
  timestamp: string;
  agent_id: string;
  agent_name: string;
  categories: string[];
  overall_score: number;
  total_tests: number;
  total_blocked: number;
  total_passed: number;
  total_time_ms: number;
  status: string;
}

interface ProgressState {
  index: number;
  total: number;
  category: string;
  prompt: string;
  eta_ms: number;
}

// ─── Severity Helpers ────────────────────────────────────────────────────────────

const SEVERITY_MAP: Record<string, string> = {
  jailbreak: "critical",
  prompt_injection: "critical",
  pii: "high",
  sexual_content: "high",
  toxicity: "high",
  manipulation: "medium",
};

function getDefaultSeverity(category: string): string {
  return SEVERITY_MAP[category] || "medium";
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case "critical": return "var(--color-danger)";
    case "high": return "#f97316";
    case "medium": return "var(--color-warning)";
    case "low": return "var(--color-text-secondary)";
    default: return "var(--color-text-secondary)";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────────

function RedTeamPage() {
  // Core state
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [error, setError] = useState("");

  // Execution state
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState("");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [report, setReport] = useState<RedTeamReport | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Run history
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedRunData, setExpandedRunData] = useState<RedTeamReport | null>(null);

  // Custom prompts
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [customPrompts, setCustomPrompts] = useState<Record<string, string[]>>({});
  const [newPromptCategory, setNewPromptCategory] = useState("");
  const [newPromptText, setNewPromptText] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDesc, setNewCategoryDesc] = useState("");

  // Triage state
  const [triageEdits, setTriageEdits] = useState<Record<number, TriageData>>({});

  // Comparison
  const [previousRun, setPreviousRun] = useState<RunSummary | null>(null);

  // Category viewer
  const [viewingCategory, setViewingCategory] = useState<string | null>(null);
  const [viewingPrompts, setViewingPrompts] = useState<string[]>([]);
  const [editingPromptIdx, setEditingPromptIdx] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState("");

  // ─── Load Initial Data ───────────────────────────────────────────────────────

  useEffect(() => {
    api.listAgents().then(setAgents).catch((e) => setError(e.message));
    loadCategories();
    loadRuns();
  }, []);

  function loadCategories() {
    api.getRedTeamCategories().then((cats) => {
      setCategories(cats);
      setSelectedCategories(cats.map((c: CategoryInfo) => c.category));
    }).catch((e) => setError(e.message));
  }

  function loadRuns() {
    api.getRedTeamRuns().then((r) => {
      setRuns(r);
    }).catch(() => { /* silent */ });
  }

  function loadCustomPrompts() {
    api.getRedTeamCustomPrompts().then(setCustomPrompts).catch(() => { /* silent */ });
  }

  useEffect(() => {
    if (promptsOpen) loadCustomPrompts();
  }, [promptsOpen]);

  // Find previous run for comparison
  useEffect(() => {
    if (report && runs.length > 0) {
      const prev = runs.find(
        (r) => r.agent_id === report.agent_id && r.id !== report.id
      );
      setPreviousRun(prev || null);
    }
  }, [report, runs]);

  // ─── Category Selection ──────────────────────────────────────────────────────

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  function selectAll() {
    setSelectedCategories(categories.map((c) => c.category));
  }

  function selectNone() {
    setSelectedCategories([]);
  }

  // ─── Run Execution (Streaming) ───────────────────────────────────────────────

  const handleRun = useCallback(() => {
    if (!selectedAgent || selectedCategories.length === 0) return;
    setRunning(true);
    setError("");
    setReport(null);
    setProgress(null);
    setRunId("");

    const ctrl = api.runRedTeamStream(
      selectedAgent,
      selectedCategories,
      (startData) => {
        setRunId(startData.run_id);
      },
      (progressData) => {
        setProgress(progressData);
      },
      (_result) => {
        // Individual results can be used for live updates if needed
      },
      (completeData) => {
        setReport(completeData);
        setRunning(false);
        setProgress(null);
        loadRuns();
      },
      (err) => {
        setError(err);
        setRunning(false);
        setProgress(null);
      },
    );

    controllerRef.current = ctrl;
  }, [selectedAgent, selectedCategories]);

  async function handleCancel() {
    if (runId) {
      try {
        await api.cancelRedTeamRun(runId);
      } catch {
        // If cancel fails, abort the connection
      }
    }
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    setRunning(false);
    setProgress(null);
  }

  // ─── Run History ─────────────────────────────────────────────────────────────

  async function handleExpandRun(id: string) {
    if (expandedRun === id) {
      setExpandedRun(null);
      setExpandedRunData(null);
      return;
    }
    try {
      const data = await api.getRedTeamRun(id);
      setExpandedRun(id);
      setExpandedRunData(data);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDeleteRun(id: string) {
    try {
      await api.deleteRedTeamRun(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
      if (expandedRun === id) {
        setExpandedRun(null);
        setExpandedRunData(null);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  // ─── Triage ──────────────────────────────────────────────────────────────────

  function handleTriageChange(index: number, field: keyof TriageData, value: string) {
    setTriageEdits((prev) => ({
      ...prev,
      [index]: {
        ...prev[index] || { status: "needs_review", severity: getDefaultSeverity(report?.failed_tests[index]?.category || ""), notes: "" },
        [field]: value,
      },
    }));
  }

  async function handleTriageSave(index: number) {
    if (!report) return;
    const triage = triageEdits[index];
    if (!triage) return;

    try {
      await api.updateRedTeamTriage(report.id, index, triage);
      // Update local report triage data
      setReport((prev) => {
        if (!prev) return prev;
        const newTriage = [...(prev.triage_data || [])];
        while (newTriage.length <= index) newTriage.push(null);
        newTriage[index] = triage;
        return { ...prev, triage_data: newTriage };
      });
    } catch (e: any) {
      setError(e.message);
    }
  }

  // ─── Custom Prompts ──────────────────────────────────────────────────────────

  async function handleAddPrompt() {
    if (!newPromptCategory || !newPromptText.trim()) return;
    try {
      await api.addRedTeamPrompt(newPromptCategory, newPromptText.trim());
      setNewPromptText("");
      loadCustomPrompts();
      loadCategories();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDeletePrompt(category: string, index: number) {
    try {
      await api.deleteRedTeamPrompt(category, index);
      loadCustomPrompts();
      loadCategories();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    try {
      await api.createRedTeamCategory(newCategoryName.trim(), newCategoryDesc.trim());
      setNewCategoryName("");
      setNewCategoryDesc("");
      loadCustomPrompts();
      loadCategories();
    } catch (e: any) {
      setError(e.message);
    }
  }

  // ─── View Category ────────────────────────────────────────────────────────

  async function handleViewCategory(category: string) {
    try {
      const data = await api.getRedTeamPrompts(category);
      setViewingCategory(category);
      setViewingPrompts(data.prompts);
      setEditingPromptIdx(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function handleCloseViewer() {
    setViewingCategory(null);
    setViewingPrompts([]);
    setEditingPromptIdx(null);
  }

  function startEditPrompt(index: number) {
    setEditingPromptIdx(index);
    setEditingPromptText(viewingPrompts[index]);
  }

  async function saveEditPrompt(index: number) {
    if (!viewingCategory || !editingPromptText.trim()) return;
    // Determine if this is a custom prompt
    const cat = viewingCategory;
    const builtinCount = categories.find((c) => c.category === cat)?.builtin_count || 0;
    const customIndex = index - builtinCount;

    if (customIndex >= 0) {
      try {
        await api.editRedTeamPrompt(cat, customIndex, editingPromptText.trim());
        // Refresh
        const data = await api.getRedTeamPrompts(cat);
        setViewingPrompts(data.prompts);
        setEditingPromptIdx(null);
        loadCategories();
      } catch (e: any) {
        setError(e.message);
      }
    } else {
      setError("Built-in prompts cannot be edited. Add a custom prompt instead.");
      setEditingPromptIdx(null);
    }
  }

  async function deletePromptFromViewer(index: number) {
    if (!viewingCategory) return;
    const cat = viewingCategory;
    const builtinCount = categories.find((c) => c.category === cat)?.builtin_count || 0;
    const customIndex = index - builtinCount;

    if (customIndex >= 0) {
      try {
        await api.deleteRedTeamPrompt(cat, customIndex);
        const data = await api.getRedTeamPrompts(cat);
        setViewingPrompts(data.prompts);
        loadCategories();
      } catch (e: any) {
        setError(e.message);
      }
    } else {
      setError("Built-in prompts cannot be deleted.");
    }
  }

  async function handleExport() {
    try {
      const data = await api.exportRedTeamPrompts();
      const blob = new Blob([JSON.stringify(data.prompts, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "redteam_prompts.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const prompts = data.prompts || data;
        const result = await api.importRedTeamPrompts(prompts);
        loadCustomPrompts();
        loadCategories();
        alert(`Imported ${result.imported_count} prompts`);
      } catch (e: any) {
        setError(e.message || "Invalid JSON file");
      }
    };
    input.click();
  }

  // ─── Computed ────────────────────────────────────────────────────────────────

  const totalPrompts = categories
    .filter((c) => selectedCategories.includes(c.category))
    .reduce((sum, c) => sum + c.count, 0);

  const scoreDelta = previousRun && report
    ? report.overall_score - previousRun.overall_score
    : null;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="redteam-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Red Team Testing</h1>
          <p className="page-subtitle">
            Run adversarial test suites against your agent to evaluate guardrail effectiveness.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error} <button className="error-dismiss" onClick={() => setError("")}>×</button></div>}

      {/* Configuration */}
      <div className="redteam-config">
        <div className="form-group">
          <label htmlFor="rt-agent">Agent</label>
          <select
            id="rt-agent"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
          >
            <option value="">Select an agent...</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>
            Test Categories
            <span className="category-actions">
              <button type="button" className="link-btn" onClick={selectAll}>All</button>
              <button type="button" className="link-btn" onClick={selectNone}>None</button>
            </span>
          </label>
          <div className="category-grid">
            {categories.map((cat) => (
              <div key={cat.category} className="category-checkbox">
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(cat.category)}
                  onChange={() => toggleCategory(cat.category)}
                />
                <span className="category-info">
                  <span className="category-name">
                    {cat.category.replace(/_/g, " ")}
                    {cat.is_custom && <span className="custom-badge">Custom</span>}
                  </span>
                  <span className="category-desc">{cat.description}</span>
                  <span className="category-count">
                    {cat.count} prompts
                    {cat.custom_count > 0 && ` (${cat.custom_count} custom)`}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-view-category"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleViewCategory(cat.category); }}
                  title="View & edit prompts"
                >
                  View
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="run-actions">
          <button
            className="btn btn-primary btn-danger-action"
            onClick={handleRun}
            disabled={running || !selectedAgent || selectedCategories.length === 0}
          >
            {running ? "Running..." : `Run Red Team Test (${totalPrompts} prompts)`}
          </button>
        </div>
      </div>

      {/* Category Viewer Panel */}
      {viewingCategory && (
        <div className="category-viewer">
          <div className="category-viewer-header">
            <h3>{viewingCategory.replace(/_/g, " ")} — Prompts ({viewingPrompts.length})</h3>
            <button className="inspect-close" onClick={handleCloseViewer}>×</button>
          </div>
          <p className="category-viewer-hint">
            Built-in prompts are read-only. Custom prompts can be edited or deleted.
          </p>
          <div className="category-viewer-list">
            {viewingPrompts.map((prompt, i) => {
              const builtinCount = categories.find((c) => c.category === viewingCategory)?.builtin_count || 0;
              const isCustom = i >= builtinCount;
              const isEditing = editingPromptIdx === i;

              return (
                <div key={i} className={`viewer-prompt-item ${isCustom ? "viewer-custom" : ""}`}>
                  <span className="viewer-prompt-index">{i + 1}</span>
                  {isEditing ? (
                    <input
                      type="text"
                      className="viewer-prompt-edit-input"
                      value={editingPromptText}
                      onChange={(e) => setEditingPromptText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEditPrompt(i); if (e.key === "Escape") setEditingPromptIdx(null); }}
                      autoFocus
                    />
                  ) : (
                    <span className="viewer-prompt-text">{prompt}</span>
                  )}
                  <span className="viewer-prompt-type">{isCustom ? "custom" : "built-in"}</span>
                  <div className="viewer-prompt-actions">
                    {isEditing ? (
                      <>
                        <button className="btn-sm btn-save" onClick={() => saveEditPrompt(i)}>Save</button>
                        <button className="btn-sm" onClick={() => setEditingPromptIdx(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        {isCustom && (
                          <>
                            <button className="btn-sm" onClick={() => startEditPrompt(i)}>Edit</button>
                            <button className="btn-sm btn-danger-sm" onClick={() => deletePromptFromViewer(i)}>Delete</button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Progress Panel */}
      {running && progress && (
        <div className="progress-panel">
          <div className="progress-header">
            <span className="progress-title">
              Testing {progress.index}/{progress.total}...
            </span>
            <button className="btn btn-cancel" onClick={handleCancel}>Cancel</button>
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(progress.index / progress.total) * 100}%` }}
              />
            </div>
            <span className="progress-percent">{Math.round((progress.index / progress.total) * 100)}%</span>
          </div>
          <div className="progress-details">
            <span className="progress-category">Category: <strong>{progress.category.replace(/_/g, " ")}</strong></span>
            <span className="progress-prompt">{progress.prompt}</span>
            {progress.eta_ms > 0 && (
              <span className="progress-eta">ETA: {Math.ceil(progress.eta_ms / 1000)}s</span>
            )}
          </div>
        </div>
      )}

      {/* Comparison Banner */}
      {report && scoreDelta !== null && scoreDelta !== 0 && (
        <div className={`comparison-banner ${scoreDelta > 0 ? "improvement" : "regression"}`}>
          <span className="comparison-icon">{scoreDelta > 0 ? "⬆" : "⬇"}</span>
          <span className="comparison-text">
            Score: {previousRun!.overall_score}% → {report.overall_score}%
            ({scoreDelta > 0 ? "+" : ""}{scoreDelta.toFixed(1)}%{" "}
            {scoreDelta > 0 ? "improvement" : "regression"})
          </span>
        </div>
      )}

      {/* Current Results */}
      {report && (
        <div className="redteam-report">
          <h2>
            Results
            <span className={`status-badge status-${report.status}`}>{report.status}</span>
          </h2>

          <div className="score-banner">
            <div className="overall-score">
              <span className="score-value">{report.overall_score}%</span>
              <span className="score-label">Adversarial Blocked</span>
            </div>
            <div className="score-meta">
              <span>{report.total_tests} total tests</span>
              <span>{report.total_blocked} blocked</span>
              <span>{report.total_passed} passed through</span>
              <span>{(report.total_time_ms / 1000).toFixed(1)}s total</span>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="category-results">
            <h3>Per-Category Breakdown</h3>
            {Object.entries(report.category_results).map(([cat, data]) => (
              <div key={cat} className="category-result-card">
                <div className="category-result-header">
                  <span className="category-result-name">{cat.replace(/_/g, " ")}</span>
                  <span className="category-result-rate">{data.block_rate}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${data.block_rate}%` }}
                  />
                </div>
                <div className="category-result-stats">
                  <span>{data.blocked}/{data.total} blocked</span>
                </div>
              </div>
            ))}
          </div>

          {/* Coverage Matrix */}
          <div className="coverage-matrix">
            <h3>Coverage Matrix</h3>
            <div className="matrix-grid">
              <div className="matrix-header-row">
                <div className="matrix-corner"></div>
                <div className="matrix-col-header">Result</div>
              </div>
              {Object.entries(report.category_results).map(([cat, data]) => (
                <div key={cat} className="matrix-row">
                  <div className="matrix-row-label">{cat.replace(/_/g, " ")}</div>
                  <div className="matrix-cells">
                    {data.results.map((r, i) => (
                      <div
                        key={i}
                        className={`matrix-cell ${r.blocked ? "cell-blocked" : "cell-passed"}`}
                        title={`${r.prompt.slice(0, 50)}... - ${r.blocked ? "Blocked" : "Passed"}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="matrix-legend">
              <span className="legend-item"><span className="legend-dot cell-blocked"></span> Blocked</span>
              <span className="legend-item"><span className="legend-dot cell-passed"></span> Passed Through</span>
            </div>
          </div>

          {/* Failed Tests with Triage */}
          {report.failed_tests.length > 0 && (
            <div className="failed-tests">
              <h3>Failed Tests ({report.failed_tests.length})</h3>
              <div className="failed-tests-list">
                {report.failed_tests.map((test, i) => {
                  const existingTriage = report.triage_data?.[i];
                  const editTriage = triageEdits[i] || existingTriage || {
                    status: "needs_review",
                    severity: getDefaultSeverity(test.category),
                    notes: "",
                  };

                  return (
                    <div key={i} className="failed-test-item-expanded">
                      <div className="failed-test-main">
                        <span
                          className="severity-badge"
                          style={{ backgroundColor: getSeverityColor(editTriage.severity) }}
                        >
                          {editTriage.severity}
                        </span>
                        <span className="failed-category">{test.category.replace(/_/g, " ")}</span>
                        <span className="failed-prompt">{test.prompt}</span>
                      </div>
                      <div className="failed-test-response">
                        <span className="response-label">Response:</span>
                        <span className="response-text">{test.response ? test.response.slice(0, 150) : "—"}</span>
                      </div>
                      <div className="triage-controls">
                        <select
                          value={editTriage.status}
                          onChange={(e) => handleTriageChange(i, "status", e.target.value)}
                          className="triage-select"
                        >
                          <option value="needs_review">Needs Review</option>
                          <option value="needs_fixing">Needs Fixing</option>
                          <option value="acceptable">Acceptable</option>
                        </select>
                        <select
                          value={editTriage.severity}
                          onChange={(e) => handleTriageChange(i, "severity", e.target.value)}
                          className="triage-select"
                        >
                          <option value="critical">Critical</option>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                        <input
                          type="text"
                          className="triage-notes"
                          placeholder="Notes..."
                          value={editTriage.notes}
                          onChange={(e) => handleTriageChange(i, "notes", e.target.value)}
                        />
                        <button
                          className="btn btn-sm btn-save"
                          onClick={() => handleTriageSave(i)}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manage Prompts (Collapsible) */}
      <div className="collapsible-section">
        <button
          className="collapsible-header"
          onClick={() => setPromptsOpen(!promptsOpen)}
        >
          <span className="collapsible-icon">{promptsOpen ? "▼" : "▶"}</span>
          <span>Manage Prompts</span>
        </button>

        {promptsOpen && (
          <div className="collapsible-content">
            <div className="prompts-actions">
              <button className="btn btn-sm" onClick={handleExport}>Export All</button>
              <button className="btn btn-sm" onClick={handleImport}>Import</button>
            </div>

            {/* Add new prompt */}
            <div className="add-prompt-form">
              <h4>Add Custom Prompt</h4>
              <div className="add-prompt-row">
                <select
                  value={newPromptCategory}
                  onChange={(e) => setNewPromptCategory(e.target.value)}
                  className="prompt-category-select"
                >
                  <option value="">Category...</option>
                  {categories.map((c) => (
                    <option key={c.category} value={c.category}>{c.category}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newPromptText}
                  onChange={(e) => setNewPromptText(e.target.value)}
                  placeholder="Enter adversarial prompt..."
                  className="prompt-input"
                />
                <button className="btn btn-sm btn-primary" onClick={handleAddPrompt}>Add</button>
              </div>
            </div>

            {/* Create new category */}
            <div className="add-category-form">
              <h4>Create Custom Category</h4>
              <div className="add-category-row">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Category name..."
                  className="category-name-input"
                />
                <input
                  type="text"
                  value={newCategoryDesc}
                  onChange={(e) => setNewCategoryDesc(e.target.value)}
                  placeholder="Description..."
                  className="category-desc-input"
                />
                <button className="btn btn-sm btn-primary" onClick={handleCreateCategory}>Create</button>
              </div>
            </div>

            {/* Custom prompts list */}
            {Object.keys(customPrompts).length > 0 && (
              <div className="custom-prompts-list">
                <h4>Custom Prompts</h4>
                {Object.entries(customPrompts).map(([cat, prompts]) => (
                  <div key={cat} className="custom-prompt-category">
                    <div className="custom-prompt-cat-header">{cat.replace(/_/g, " ")}</div>
                    {prompts.map((p, i) => (
                      <div key={i} className="custom-prompt-item">
                        <span className="custom-prompt-text">{p}</span>
                        <button
                          className="btn btn-sm btn-danger-sm"
                          onClick={() => handleDeletePrompt(cat, i)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Run History (Collapsible) */}
      <div className="collapsible-section">
        <button
          className="collapsible-header"
          onClick={() => setHistoryOpen(!historyOpen)}
        >
          <span className="collapsible-icon">{historyOpen ? "▼" : "▶"}</span>
          <span>Run History ({runs.length})</span>
        </button>

        {historyOpen && (
          <div className="collapsible-content">
            {runs.length === 0 ? (
              <p className="empty-state">No runs yet. Run a red team test to see history.</p>
            ) : (
              <div className="runs-list">
                {runs.map((run) => (
                  <div key={run.id} className="run-item">
                    <div className="run-item-header" onClick={() => handleExpandRun(run.id)}>
                      <div className="run-item-info">
                        <span className="run-date">{new Date(run.timestamp).toLocaleString()}</span>
                        <span className="run-agent">{run.agent_name}</span>
                        <span className={`status-badge status-${run.status}`}>{run.status}</span>
                      </div>
                      <div className="run-item-stats">
                        <span className="run-score">{run.overall_score}%</span>
                        <span className="run-tests">{run.total_tests} tests</span>
                        <span className="run-duration">{(run.total_time_ms / 1000).toFixed(1)}s</span>
                        <button
                          className="btn btn-sm btn-danger-sm"
                          onClick={(e) => { e.stopPropagation(); handleDeleteRun(run.id); }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {expandedRun === run.id && expandedRunData && (
                      <div className="run-expanded">
                        <div className="run-expanded-score">
                          <span className="score-value-sm">{expandedRunData.overall_score}%</span>
                          <span className="score-detail">
                            {expandedRunData.total_blocked}/{expandedRunData.total_tests} blocked
                          </span>
                        </div>
                        {Object.entries(expandedRunData.category_results).map(([cat, data]) => (
                          <div key={cat} className="run-expanded-cat">
                            <span className="run-cat-name">{cat.replace(/_/g, " ")}</span>
                            <span className="run-cat-rate">{data.block_rate}%</span>
                            <div className="progress-bar mini">
                              <div className="progress-fill" style={{ width: `${data.block_rate}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RedTeamPage;
