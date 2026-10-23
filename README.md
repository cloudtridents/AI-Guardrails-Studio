# Agentic AI Guardrails Interactive Studio

An interactive web application for configuring, managing, and testing NVIDIA NeMo Guardrails before applying them to AI agents.

## Architecture

- **Backend**: FastAPI + NeMo Guardrails (Python)
- **Frontend**: React + Vite + TypeScript

## Features

- Create, edit, and delete guardrail configurations
- Interactive chat interface to test guardrails in real-time
- View guardrail activation logs and trace which rails fired
- Export configurations for deployment to AI agents

## Quick Start

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173

## Environment Variables

Create `backend/.env`:

```
OPENAI_API_KEY=your-key-here
```

## Decision Backends

The local classifier supports three decision backends, selectable per-request or
globally via `PUT /api/classifier/backend`:

- `bert` (default) — local DistilBERT zero-shot classifier (`typeform/distilbert-base-uncased-mnli`).
- `strands` — the [strands-decider](https://pypi.org/project/strands-decider/) decision
  model, served over HTTP and reached via `STRANDS_DECIDER_URL` (default `http://localhost:8100`).
- `combined` — runs both; a category triggers if *either* backend crosses its threshold.

Set `DECISION_BACKEND=bert|strands|combined` to choose the default at startup.

### Running the strands-decider model locally

strands-decider pulls heavy deps (torch/transformers), so it runs as a **separate
process** and is reached over HTTP:

```bash
pip install strands-decider
# downloads the LoRA adapter + Qwen/Qwen3.5-2B-Base on first run
strands-decider serve StrandsAgents/strands-decider-2B-hobson-v19 --port 8100 --device cpu
```

Then point the backend at it: `STRANDS_DECIDER_URL=http://127.0.0.1:8100`.

## Running on an exFAT drive (no symlinks)

exFAT cannot host a Python virtualenv (venvs rely on symlinks). If this repo lives
on such a drive, create the venv on a symlink-capable filesystem (e.g. your home
directory) and let it reach the heavy packages that are already installed on the
exFAT drive via a `.pth` file:

```bash
python3.12 -m venv ~/guardrails-venv
# expose the exFAT-installed heavy packages (torch/transformers/nemoguardrails/...)
echo "/media/<drive>/.../backend/venv/lib/python3.12/site-packages" \
  > ~/guardrails-venv/lib/python3.12/site-packages/zz_exfat_heavy.pth
# install/upgrade the light web stack into the home venv (shadows the exFAT copies)
~/guardrails-venv/bin/python -m pip install -r backend/requirements.txt
```

Point `app.sh` at this interpreter and keep the HF model cache on the roomy exFAT drive:

```bash
BACKEND_PYTHON=~/guardrails-venv/bin/python \
HF_HOME=/media/<drive>/.../guardrails/.hf_cache \
./app.sh start
```

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI application
│   │   ├── routers/         # API route handlers
│   │   ├── services/        # Guardrails service layer
│   │   └── models/          # Pydantic models
│   ├── configs/             # Stored guardrail configurations
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── pages/           # Page components
│   │   ├── api/             # API client
│   │   └── types/           # TypeScript types
│   └── package.json
└── README.md
```
