import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import ConfigListPage from "./pages/ConfigListPage";
import ConfigEditorPage from "./pages/ConfigEditorPage";
import TestingPage from "./pages/TestingPage";
import AgentListPage from "./pages/AgentListPage";
import AgentEditorPage from "./pages/AgentEditorPage";
import AgentTestingPage from "./pages/AgentTestingPage";
import MetricsPage from "./pages/MetricsPage";
import BatchTestPage from "./pages/BatchTestPage";
import TemplatesPage from "./pages/TemplatesPage";
import ComparisonPage from "./pages/ComparisonPage";
import GraphPage from "./pages/GraphPage";
import ClassifierPage from "./pages/ClassifierPage";
import RedTeamPage from "./pages/RedTeamPage";
import ABTestPage from "./pages/ABTestPage";
import ExportPage from "./pages/ExportPage";
import AuditPage from "./pages/AuditPage";

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/agents" replace />} />
        <Route path="/agents" element={<AgentListPage />} />
        <Route path="/agents/new" element={<AgentEditorPage />} />
        <Route path="/agents/:id" element={<AgentEditorPage />} />
        <Route path="/agents/:id/test" element={<AgentTestingPage />} />
        <Route path="/agents/:id/compare" element={<ComparisonPage />} />
        <Route path="/configs" element={<ConfigListPage />} />
        <Route path="/configs/new" element={<ConfigEditorPage />} />
        <Route path="/configs/:id" element={<ConfigEditorPage />} />
        <Route path="/test/:id" element={<TestingPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/batch" element={<BatchTestPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/graph/:id" element={<GraphPage />} />
        <Route path="/classifier" element={<ClassifierPage />} />
        <Route path="/redteam" element={<RedTeamPage />} />
        <Route path="/ab-test" element={<ABTestPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/audit" element={<AuditPage />} />
      </Routes>
    </Layout>
  );
}

export default App;
