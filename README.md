# Interview Me

Practice job interviews with a live AI voice interviewer, then get a written assessment. Single user, runs locally, nothing is stored.

## Layout

- `backend/` Python (FastAPI, Google ADK, Gemini Live API), managed with `uv`
- `frontend/` React + Vite (not started)
- `.scratch/` local planning notes and tickets (gitignored)

## Run the backend

```
cd backend
cp .env.example .env     # then put your AI Studio key in .env
uv run uvicorn app.main:app --reload
```

- Health check: http://127.0.0.1:8000/health
- Interview WebSocket: `ws://127.0.0.1:8000/ws/interview` (protocol in `backend/app/bridge.py`)

## Test

```
cd backend
uv run pytest
```
