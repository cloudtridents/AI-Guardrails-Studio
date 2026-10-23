"""FastAPI application for NeMo Guardrails Interactive Testing UI."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.routers import configs, chat, agents, sessions, metrics, batch, templates, graph, classifier, redteam, ab_testing, export, audit

load_dotenv()

app = FastAPI(
    title="NeMo Guardrails Testing UI",
    description="Interactive UI for configuring and testing NVIDIA NeMo Guardrails with multi-agent support",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:9000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(configs.router, prefix="/api/configs", tags=["configurations"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(metrics.router, prefix="/api/metrics", tags=["metrics"])
app.include_router(batch.router, prefix="/api/batch", tags=["batch"])
app.include_router(templates.router, prefix="/api/templates", tags=["templates"])
app.include_router(graph.router, prefix="/api/graph", tags=["graph"])
app.include_router(classifier.router, prefix="/api/classifier", tags=["classifier"])
app.include_router(redteam.router, prefix="/api/redteam", tags=["redteam"])
app.include_router(ab_testing.router, prefix="/api/ab-test", tags=["ab-testing"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
app.include_router(audit.router, prefix="/api/audit", tags=["audit"])


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "version": "3.0.0"}
