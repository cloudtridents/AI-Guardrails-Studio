import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import type { AgentSummary } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Plus, Settings, Play, GitCompare, Trash2 } from "lucide-react";

function AgentListPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    try {
      setLoading(true);
      const data = await api.listAgents();
      setAgents(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete agent "${name}"?`)) return;
    try {
      await api.deleteAgent(id);
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading agents...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Agents</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure LangChain agents with input and output guardrail pipelines.
          </p>
        </div>
        <Button onClick={() => navigate("/agents/new")}>
          <Plus className="h-4 w-4" />
          New Agent
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-1">No agents configured</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first AI agent to get started.
            </p>
            <Button onClick={() => navigate("/agents/new")}>Create Agent</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card
              key={agent.id}
              className={`transition-colors hover:border-primary/50 ${!agent.enabled ? "opacity-60" : ""}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{agent.name}</CardTitle>
                  <Badge variant={agent.enabled ? "success" : "secondary"}>
                    {agent.enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <CardDescription className="line-clamp-2">
                  {agent.description || "No description"}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-xs">
                    {agent.model}
                  </Badge>
                  {agent.input_guardrail_id && (
                    <Badge variant="warning" className="text-xs">
                      Input Rails
                    </Badge>
                  )}
                  {agent.output_guardrail_id && (
                    <Badge variant="warning" className="text-xs">
                      Output Rails
                    </Badge>
                  )}
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/agents/${agent.id}`)}
                >
                  <Settings className="h-3.5 w-3.5" />
                  Configure
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate(`/agents/${agent.id}/test`)}
                >
                  <Play className="h-3.5 w-3.5" />
                  Test
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/agents/${agent.id}/compare`)}
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  A/B
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(agent.id, agent.name)}
                  aria-label={`Delete ${agent.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default AgentListPage;
