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
- Interview WebSocket: `ws://127.0.0.1:8000/ws/interview` (protocol in `backend/app/bridge.py`). The first frame the browser sends decides the plan, with no timeout: a `start` message carries the prepared plan, and any other first frame (such as audio) selects the built-in sample plan. The backend answers with a `plan_source` message naming which plan it used (and, for the sample plan, the plan itself), so the assessment is always graded against the questions that were actually asked.

## Run the frontend

Start the backend first (above), then in a second terminal:

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, paste the job description, company summary and resume, and press Prepare interview. The backend prepares a seven-question plan (one free text-model request) and the interview starts with it; the plan is not shown. The dev server forwards `/ws` and `/api` to the backend on port 8000, so the page needs no cross-origin setup. When the interview ends, the page shows a report: the backend assesses the finished transcript against the plan (one more free text-model request, never retried automatically; the text model allows 5 requests a minute and 20 a day). The report can be downloaded as Markdown, the transcript can always be downloaded, and a button starts a new interview from the same briefing. The endpoint is `POST /api/assessment`; nothing is stored. Headphones are recommended. The microphone only works on `localhost` or HTTPS.

## When something fails

- A quota or model error mid-interview, or the connection dropping, ends that interview with a plain message and keeps the transcript on screen and downloadable. Resuming is not attempted. If you had answered at least once, an "Assess what was said" button offers the assessment; it never runs by itself, because the text model only allows 20 requests a day.
- Quota messages cannot tell a per-minute limit from a daily one, so they say to wait a minute and that the free tier allows a limited number a day. No quota error is retried automatically.
- If the backend is unreachable when the interview starts, the page says so and "Start again" retries with the briefing and plan kept. A failed plan keeps the pasted briefing; a failed assessment keeps the transcript downloadable.
- Backend failure wording is in `backend/app/errors.py`; the page's own is in `frontend/src/failures.ts`.

## Test

```
cd backend
uv run pytest

cd frontend
npm test
npm run build
```
