import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import "./TemplatesPage.css";

interface Template {
  id: string;
  name: string;
  description: string;
}

function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .listTemplates()
      .then(setTemplates)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleApply(templateId: string) {
    setApplying(templateId);
    try {
      const config = await api.applyTemplate(templateId);
      navigate(`/configs/${config.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApplying(null);
    }
  }

  if (loading) return <div className="loading">Loading templates...</div>;

  const generalTemplates = templates.filter((t) => !t.id.startsWith("tpl-gov"));
  const governmentTemplates = templates.filter((t) => t.id.startsWith("tpl-gov"));

  return (
    <div className="templates-page">
      <div className="page-header">
        <div>
          <h1>Configuration Templates</h1>
          <p className="page-subtitle">
            Pre-built guardrail configurations for common use cases. Apply a
            template to create a new config instantly.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* General Templates */}
      <div className="templates-category">
        <div className="category-banner general-banner">
          <span className="category-icon">🔧</span>
          <div>
            <h2>General Templates</h2>
            <p>Universal guardrails for any AI agent — safety, content filtering, and access control.</p>
          </div>
        </div>
        <div className="templates-grid">
          {generalTemplates.map((tpl) => (
            <div key={tpl.id} className="template-card">
              <div className="template-card-body">
                <h3>{tpl.name}</h3>
                <p>{tpl.description}</p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => handleApply(tpl.id)}
                disabled={applying === tpl.id}
              >
                {applying === tpl.id ? "Creating..." : "Use Template"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Government Templates */}
      <div className="templates-category">
        <div className="category-banner government-banner">
          <span className="category-icon">🏛️</span>
          <div>
            <h2>Government & County Agency</h2>
            <p>Specialized guardrails for public sector AI — legal compliance, political neutrality, ADA, and citizen data protection.</p>
          </div>
        </div>
        <div className="templates-grid">
          {governmentTemplates.map((tpl) => (
            <div key={tpl.id} className="template-card government-card">
              <div className="template-card-body">
                <h3>{tpl.name}</h3>
                <p>{tpl.description}</p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => handleApply(tpl.id)}
                disabled={applying === tpl.id}
              >
                {applying === tpl.id ? "Creating..." : "Use Template"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default TemplatesPage;
