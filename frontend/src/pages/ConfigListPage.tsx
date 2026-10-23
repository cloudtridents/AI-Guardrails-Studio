import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { GuardrailConfigSummary } from "../types";
import "./ConfigListPage.css";

function ConfigListPage() {
  const [configs, setConfigs] = useState<GuardrailConfigSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    loadConfigs();
  }, []);

  async function loadConfigs() {
    try {
      setLoading(true);
      const data = await api.listConfigs();
      setConfigs(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete configuration "${name}"?`)) return;
    try {
      await api.deleteConfig(id);
      setConfigs((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) return <div className="loading">Loading configurations...</div>;

  return (
    <div className="config-list-page">
      <div className="page-header">
        <div>
          <h1>Guardrail Configurations</h1>
          <p className="page-subtitle">
            Manage your NeMo Guardrails configurations and test them interactively.
          </p>
        </div>
        <Link to="/configs/new" className="btn btn-primary">
          + New Configuration
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {configs.length === 0 ? (
        <div className="empty-state">
          <h3>No configurations yet</h3>
          <p>Create your first guardrail configuration to get started.</p>
          <Link to="/configs/new" className="btn btn-primary">
            Create Configuration
          </Link>
        </div>
      ) : (
        <div className="config-grid">
          {configs.map((config) => (
            <div key={config.id} className="config-card">
              <div className="config-card-body">
                <h3>{config.name}</h3>
                <p>{config.description || "No description"}</p>
              </div>
              <div className="config-card-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate(`/configs/${config.id}`)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => navigate(`/test/${config.id}`)}
                >
                  Test
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(config.id, config.name)}
                  aria-label={`Delete ${config.name}`}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ConfigListPage;
