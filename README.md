# divthink

A canvas for branching conversations with LLMs. Every prompt and reply is a box: reply to
any box, branch from highlighted text, or merge several branches into one prompt.

**Stack:** FastAPI · Postgres · React + React Flow · Claude and Gemini

## Run locally

Requires Docker, Python 3.13, and Node 22.

```bash
# Database
docker compose up -d

# Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # add ANTHROPIC_API_KEY and/or GOOGLE_API_KEY
.venv/bin/uvicorn app.main:app --reload --timeout-graceful-shutdown 3

# Frontend (new terminal)
cd frontend
nvm use && npm install && npm run dev
```

Open http://localhost:5173.
