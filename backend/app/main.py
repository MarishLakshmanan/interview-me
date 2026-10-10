"""FastAPI entry point: a health check and the interview WebSocket."""

import json
import logging

from fastapi import Body, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.assessment import build_assessment
from app.bridge import InterviewBridge
from app.config import Settings, load_settings
from app.gateway import GeminiGateway, RealGeminiGateway
from app.plan import SAMPLE_PLAN, PlanError, build_plan, plan_from_payload, plan_to_payload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def parse_start_message(message: dict) -> dict | None:
    """Recognise a text frame that is a `start` message.

    Args:
        message (dict): A raw ASGI WebSocket receive message.

    Returns:
        dict | None: The parsed start message, or None if the frame is anything else.
    """
    try:
        body = json.loads(message["text"]) if message.get("text") else None
    except json.JSONDecodeError:
        return None
    return body if isinstance(body, dict) and body.get("type") == "start" else None


def create_app(gateway: GeminiGateway | None = None, settings: Settings | None = None) -> FastAPI:
    """Build the web app, with Gemini access and settings that tests can replace.

    Args:
        gateway (GeminiGateway, optional): How the backend reaches Gemini. Defaults to None (the real one).
        settings (Settings, optional): Fixed settings. Defaults to None (read from the environment per connection).

    Returns:
        FastAPI: The app with its health check and interview WebSocket.
    """
    gateway = gateway or RealGeminiGateway()
    app = FastAPI(title="Interview Me")

    @app.get("/health")
    async def health() -> dict:
        """Report that the server is up, for a quick check from the browser or curl.

        Returns:
            dict: A fixed status message.
        """
        return {"status": "ok"}

    @app.post("/api/plan")
    async def create_plan(briefing: dict = Body(default_factory=dict)) -> JSONResponse:
        """Prepare the question plan for a briefing, including the strong-answer points.

        Args:
            briefing (dict): JSON with job_description, company_summary and resume, all required.

        Returns:
            JSONResponse: {"questions": [...]} on success, or {"error": message} with a 4xx/5xx status.
        """
        try:
            active_settings = settings or load_settings()
            questions = await build_plan(gateway, active_settings, briefing)
        except PlanError as error:
            return JSONResponse({"error": str(error)}, status_code=error.status)
        except RuntimeError as error:
            return JSONResponse({"error": str(error)}, status_code=500)
        return JSONResponse({"questions": plan_to_payload(questions)})

    @app.post("/api/assessment")
    async def create_assessment(request: dict = Body(default_factory=dict)) -> JSONResponse:
        """Assess a finished interview from the briefing, plan and transcript; nothing is stored.

        Args:
            request (dict): JSON with briefing, plan, lines (each with its question number) and reached.

        Returns:
            JSONResponse: The assessment on success, or {"error": message} with a 4xx/5xx status.
        """
        try:
            active_settings = settings or load_settings()
            assessment = await build_assessment(gateway, active_settings, request)
        except PlanError as error:  # AssessmentError is a PlanError
            return JSONResponse({"error": str(error)}, status_code=error.status)
        except RuntimeError as error:
            return JSONResponse({"error": str(error)}, status_code=500)
        return JSONResponse(assessment)

    @app.websocket("/ws/interview")
    async def interview(websocket: WebSocket) -> None:
        """Run one voice interview over this connection, then close it.

        Args:
            websocket (WebSocket): The browser's connection; see app.bridge for the message protocol.
        """
        await websocket.accept()
        try:
            active_settings = settings or load_settings()
        except RuntimeError as error:
            await websocket.send_text(json.dumps({"type": "error", "message": str(error)}))
            await websocket.close(code=1011)
            return

        first = await websocket.receive()  # the first frame decides the plan; there is no timeout
        if first["type"] == "websocket.disconnect":
            return
        plan, first_message, source = SAMPLE_PLAN, first, "sample"
        start = parse_start_message(first)
        if start is not None:
            try:
                plan, first_message, source = plan_from_payload(start.get("plan")), None, "start_message"
            except ValueError as error:
                await websocket.send_text(json.dumps({"type": "error", "message": f"Invalid plan: {error}"}))
                await websocket.close(code=1008)
                return
        announcement = {"type": "plan_source", "source": source}
        if source == "sample":  # the browser has no copy of the sample plan; it needs one to grade against
            announcement["plan"] = plan_to_payload(plan)
        await websocket.send_text(json.dumps(announcement))

        await InterviewBridge(websocket, active_settings, plan, gateway, first_message).run()
        try:
            await websocket.close()
        except (WebSocketDisconnect, RuntimeError):
            pass  # the browser already closed its side

    return app


app = create_app()
