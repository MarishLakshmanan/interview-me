"""FastAPI entry point: a health check and the interview WebSocket."""

import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.bridge import InterviewBridge
from app.config import Settings, load_settings
from app.gateway import GeminiGateway, RealGeminiGateway
from app.interviewer import SAMPLE_PLAN

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


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

        await InterviewBridge(websocket, active_settings, SAMPLE_PLAN, gateway).run()
        try:
            await websocket.close()
        except (WebSocketDisconnect, RuntimeError):
            pass  # the browser already closed its side

    return app


app = create_app()
