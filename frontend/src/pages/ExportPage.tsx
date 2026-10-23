import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AgentSummary } from "../types";
import "./ExportPage.css";

interface ExportData {
  agent_id: string;
  agent_name: string;
  docker_compose: string;
  kubernetes_yaml: string;
  python_sdk_snippet: string;
  nemo_config_files: Record<string, string>;
  readme: string;
}

type TabKey = "docker" | "kubernetes" | "python" | "nemo" | "readme";

function ExportPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [exportData, setExportData] = useState<ExportData | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("docker");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.listAgents().then(setAgents).catch((e) => setError(e.message));
  }, []);

  async function handleExport() {
    if (!selectedAgent) return;
    setLoading(true);
    setError("");
    setExportData(null);

    try {
      const result = await api.exportAgent(selectedAgent);
      setExportData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function getTabContent(): string {
    if (!exportData) return "";
    switch (activeTab) {
      case "docker":
        return exportData.docker_compose;
      case "kubernetes":
        return exportData.kubernetes_yaml;
      case "python":
        return exportData.python_sdk_snippet;
      case "nemo":
        return Object.entries(exportData.nemo_config_files)
          .map(([name, content]) => `# ─── ${name} ───\n\n${content}`)
          .join("\n\n");
      case "readme":
        return exportData.readme;
      default:
        return "";
    }
  }

  function getTabFilename(): string {
    switch (activeTab) {
      case "docker":
        return "docker-compose.yml";
      case "kubernetes":
        return "kubernetes.yaml";
      case "python":
        return "sdk_example.py";
      case "nemo":
        return "config.yml";
      case "readme":
        return "README.md";
      default:
        return "export.txt";
    }
  }

  async function handleCopy() {
    const content = getTabContent();
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "docker", label: "Docker" },
    { key: "kubernetes", label: "Kubernetes" },
    { key: "python", label: "Python SDK" },
    { key: "nemo", label: "NeMo Config" },
    { key: "readme", label: "README" },
  ];

  return (
    <div className="export-page">
      <div className="page-header">
        <div>
          <h1>Export / Deploy</h1>
          <p className="page-subtitle">
            Generate production-ready deployment packages from your agent configuration.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="export-config">
        <div className="form-group">
          <label htmlFor="export-agent">Agent</label>
          <select
            id="export-agent"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
          >
            <option value="">Select an agent...</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleExport}
          disabled={loading || !selectedAgent}
        >
          {loading ? "Generating..." : "Generate Deployment Package"}
        </button>
      </div>

      {exportData && (
        <div className="export-result">
          <div className="export-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`export-tab ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="export-content">
            <div className="export-toolbar">
              <span className="export-filename">{getTabFilename()}</span>
              <button className="btn btn-sm" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
            </div>
            <pre className="export-code">
              <code>{getTabContent()}</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExportPage;
