"""FastAPI entry point: a health check and the interview WebSocket."""

import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.bridge import InterviewBridge
from app.config import load_settings
from app.interviewer import SAMPLE_PLAN

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

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
        settings = load_settings()
    except RuntimeError as error:
        await websocket.send_text(json.dumps({"type": "error", "message": str(error)}))
        await websocket.close(code=1011)
        return

    await InterviewBridge(websocket, settings, SAMPLE_PLAN).run()
    try:
        await websocket.close()
    except (WebSocketDisconnect, RuntimeError):
        pass  # the browser already closed its side
