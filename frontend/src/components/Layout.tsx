import { Link, useLocation } from "react-router-dom";
import { useState, useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import {
  Bot,
  Shield,
  LayoutTemplate,
  FlaskConical,
  BarChart3,
  Sun,
  Moon,
  Monitor,
  Workflow,
  Cpu,
  Swords,
  GitCompare,
  Package,
  ScrollText,
} from "lucide-react";

interface Props {
  children: ReactNode;
}

const navItems = [
  { path: "/agents", label: "Agents", icon: Bot },
  { path: "/configs", label: "Guardrails", icon: Shield },
  { path: "/templates", label: "Templates", icon: LayoutTemplate },
  { path: "/graph", label: "Pipeline", icon: Workflow },
  { path: "/classifier", label: "Classifier", icon: Cpu },
  { path: "/batch", label: "Batch Test", icon: FlaskConical },
  { path: "/redteam", label: "Red Team", icon: Swords },
  { path: "/ab-test", label: "A/B Test", icon: GitCompare },
  { path: "/metrics", label: "Metrics", icon: BarChart3 },
  { path: "/audit", label: "Audit Log", icon: ScrollText },
  { path: "/export", label: "Export", icon: Package },
];

function Layout({ children }: Props) {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  const themeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const nextTheme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  const themeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";

  function isActive(path: string) {
    if (path === "/configs") {
      return (
        location.pathname.startsWith("/configs") ||
        location.pathname.startsWith("/test")
      );
    }
    return location.pathname.startsWith(path);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-card">
        {/* Brand */}
        <div className="flex items-center gap-3 px-6 py-5 border-b">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Shield className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">NeMo Guardrails</h1>
            <p className="text-xs text-muted-foreground">AI Evaluation Platform</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive(path)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Theme Toggle */}
        <div className="border-t px-3 py-3">
          <button
            onClick={() => setTheme(nextTheme)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {(() => { const Icon = themeIcon; return <Icon className="h-4 w-4" />; })()}
            {themeLabel} Theme
          </button>
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4">
          <p className="text-xs text-muted-foreground">
            Built with <span className="font-medium text-foreground/70">NVIDIA NeMo Guardrails</span> v0.23.0
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            LangChain v1.3 · LangGraph · FastAPI · React · DistilBERT
          </p>
          <FooterClock />
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="md:hidden flex items-center justify-between border-b px-4 py-3 bg-card">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <Shield className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold">NeMo Guardrails</span>
          </div>
          <nav className="flex gap-2">
            {navItems.map(({ path, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                className={cn(
                  "p-2 rounded-md",
                  isActive(path) ? "bg-primary/10 text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </Link>
            ))}
          </nav>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

function FooterClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="text-xs text-muted-foreground mt-1 font-mono tabular-nums">
      {time.toLocaleDateString()} {time.toLocaleTimeString()}
    </p>
  );
}

export default Layout;
