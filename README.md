# MAI - 多模型协作讨论平台

This repository contains a v1 development implementation following the product and technical design documents in `docs/`.

## Local Development

Backend:

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m app.init_db
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
pnpm install
pnpm dev --host 0.0.0.0 --port 5173
```

Default database URL:

```text
postgresql+asyncpg://mai:mai_dev_password@localhost:5432/mai
```

The backend defaults to `MOCK_LLM=true`, so the app can be developed without provider API keys. Set `MOCK_LLM=false` and use LiteLLM-compatible model/API key environment variables for real provider calls.

