# Interview Me

Practice job interviews with a live AI voice interviewer, then get a written assessment. Single user, runs locally, nothing is stored.

## Layout

- `backend/` Python (FastAPI, Google ADK, Gemini Live API), managed with `uv`
- `frontend/` React + Vite + TypeScript, managed with `npm`
- `.scratch/` local planning notes and tickets (gitignored)

## Run the backend

```
cd backend
cp .env.example .env     # then put your AI Studio key in .env
uv run uvicorn app.main:app --reload
```

- Health check: http://127.0.0.1:8000/health
- Interview WebSocket: `ws://127.0.0.1:8000/ws/interview` (protocol in `backend/app/bridge.py`)

## Run the frontend

Start the backend first (above), then in a second terminal:

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, paste the job description, company summary and resume, and press Prepare interview. The backend prepares a seven-question plan (one free text-model request) and the interview starts with it; the plan is not shown. The dev server forwards `/ws` and `/api` to the backend on port 8000, so the page needs no cross-origin setup. When the interview ends, the page shows a report: the backend assesses the finished transcript against the plan (one more free text-model request, never retried automatically; the text model allows 5 requests a minute and 20 a day). The report can be downloaded as Markdown, the transcript can always be downloaded, and a button starts a new interview from the same briefing. The endpoint is `POST /api/assessment`; nothing is stored. Headphones are recommended. The microphone only works on `localhost` or HTTPS.

## Test

```
cd backend
uv run pytest

cd frontend
npm test
npm run build
```
