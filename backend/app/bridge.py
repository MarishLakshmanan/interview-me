"""Relays one interview between the browser's WebSocket and a live Gemini session through ADK.

Wire protocol (first pass):

Browser -> backend
    binary frame   16 kHz, 16-bit, mono PCM microphone audio
    text frame     {"type": "end"}  the candidate ends the interview early

Backend -> browser
    binary frame   24 kHz, 16-bit, mono PCM interviewer audio
    text frame     {"type": "transcript", "speaker": "candidate" | "interviewer", "text": str, "final": bool}
                   {"type": "question", "number": int}
                   {"type": "interrupted"}  stop playback and drop queued audio
                   {"type": "turn_complete"}
                   {"type": "error", "message": str}
                   {"type": "interview_ended", "reason": str, "transcript": [{"speaker": str, "text": str}]}
"""

import asyncio
import json
import logging
import time
from dataclasses import asdict, dataclass
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.config import Settings
from app.interviewer import build_interviewer

log = logging.getLogger(__name__)

APP_NAME = "interview-me"
USER_ID = "candidate"
INPUT_MIME = "audio/pcm;rate=16000"
KICKOFF_TEXT = "Hello, I'm ready. Please begin the interview."


@dataclass
class TranscriptLine:
    """One finished line of the conversation.

    Attributes:
        speaker (str): Either "candidate" or "interviewer".
        text (str): What was said, as transcribed.
    """

    speaker: str
    text: str


class InterviewBridge:
    """Runs a single interview: audio in from the browser, audio and captions back out."""

    def __init__(self, websocket: WebSocket, settings: Settings, plan: list[str]) -> None:
        """Set up the bridge for one interview.

        Args:
            websocket (WebSocket): The accepted connection to the browser.
            settings (Settings): Models, voice and time limits.
            plan (list[str]): The planned questions, in order.
        """
        self._ws = websocket
        self._settings = settings
        self._plan = plan
        self._queue = LiveRequestQueue()
        self._transcript: list[TranscriptLine] = []
        self._end_reason: str | None = None
        self._browser_gone = False
        self._goodbye_pending = False
        self._goodbye_spoken = False
        self._grace_task: asyncio.Task | None = None

    async def run(self) -> list[TranscriptLine]:
        """Hold the interview from the opening line until it ends for any reason.

        Returns:
            list[TranscriptLine]: The finished lines of the conversation, in order.
        """
        session_service = InMemorySessionService()
        runner = Runner(
            app_name=APP_NAME,
            agent=build_interviewer(self._plan, self._settings.live_model),
            session_service=session_service,
        )
        session_id = uuid4().hex
        await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=session_id)

        helpers = [asyncio.create_task(self._upstream()), asyncio.create_task(self._time_limit())]
        self._queue.send_content(types.Content(role="user", parts=[types.Part(text=KICKOFF_TEXT)]))
        started = time.monotonic()
        try:
            async for event in runner.run_live(
                user_id=USER_ID,
                session_id=session_id,
                live_request_queue=self._queue,
                run_config=self._run_config(),
            ):
                await self._handle_event(event)
        except Exception as error:  # report any failure to the browser instead of dropping it
            log.exception("Live session failed")
            self._end_reason = self._end_reason or "error"
            await self._send_json({"type": "error", "message": f"{type(error).__name__}: {error}"})
        finally:
            for task in [*helpers, self._grace_task]:
                if task:
                    task.cancel()
            self._queue.close()
        log.info("Interview ended (%s) after %.0f s", self._end_reason or "completed", time.monotonic() - started)
        await self._send_json(
            {
                "type": "interview_ended",
                "reason": self._end_reason or "completed",
                "transcript": [asdict(line) for line in self._transcript],
            }
        )
        return self._transcript

    def _run_config(self) -> RunConfig:
        """Build the live session options: voice, plus the two settings a 20-minute interview needs.

        Returns:
            RunConfig: Options for ADK's live run.
        """
        return RunConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=self._settings.voice)
                )
            ),
            # Reconnects across the ~10 minute connection limit.
            session_resumption=types.SessionResumptionConfig(),
            # Lifts the 15 minute audio-session cap; the trigger is never reached at interview length.
            context_window_compression=types.ContextWindowCompressionConfig(
                trigger_tokens=100000, sliding_window=types.SlidingWindow(target_tokens=80000)
            ),
        )

    async def _handle_event(self, event) -> None:
        """Forward one ADK live event to the browser and update the interview state.

        Args:
            event (Event): An event yielded by `Runner.run_live()`.
        """
        if event.error_code:
            await self._send_json({"type": "error", "message": f"{event.error_code}: {event.error_message}"})

        if event.interrupted:
            await self._send_json({"type": "interrupted"})

        for part in event.content.parts if event.content and event.content.parts else []:
            if part.inline_data and part.inline_data.data:
                await self._send_bytes(part.inline_data.data)

        for speaker, transcription in (
            ("candidate", event.input_transcription),
            ("interviewer", event.output_transcription),
        ):
            if transcription and transcription.text:
                final = not event.partial
                await self._send_json(
                    {"type": "transcript", "speaker": speaker, "text": transcription.text, "final": final}
                )
                if final:
                    self._transcript.append(TranscriptLine(speaker, transcription.text.strip()))
                    if speaker == "interviewer" and self._goodbye_pending:
                        self._goodbye_spoken = True

        for call in event.get_function_calls():
            if call.name == "next_question":
                await self._send_json({"type": "question", "number": (call.args or {}).get("question_number")})
            elif call.name == "end_interview":
                self._goodbye_pending = True
                self._grace_task = asyncio.create_task(self._close_after_grace())

        if event.turn_complete:
            await self._send_json({"type": "turn_complete"})
            # ADK also sends empty turn_complete events after tool calls, so only the goodbye
            # being spoken counts as the end of the interview.
            if self._goodbye_pending and self._goodbye_spoken:
                self._finish("completed")

    async def _upstream(self) -> None:
        """Read the browser's frames: microphone audio into the live queue, plus control messages."""
        try:
            while True:
                message = await self._ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes"):
                    self._queue.send_realtime(types.Blob(mime_type=INPUT_MIME, data=message["bytes"]))
                elif message.get("text"):
                    try:
                        control = json.loads(message["text"])
                    except json.JSONDecodeError:
                        log.warning("Ignoring malformed control message")
                        continue
                    if control.get("type") == "end":
                        self._finish("candidate")
                        return
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            if self._end_reason is None:  # the loop ended without an "end" message: the browser left
                self._browser_gone = True
                self._finish("candidate_left")

    async def _time_limit(self) -> None:
        """End the interview when the hard time limit passes, since ADK does not enforce one live."""
        await asyncio.sleep(self._settings.max_interview_seconds)
        self._finish("time_limit")

    async def _close_after_grace(self) -> None:
        """Close the interview if the closing words never finish, so it cannot hang open."""
        await asyncio.sleep(self._settings.goodbye_grace_seconds)
        self._finish("completed")

    def _finish(self, reason: str) -> None:
        """Mark the interview over and close the live queue; only the first reason is kept.

        Args:
            reason (str): Why it ended: completed, candidate, candidate_left or time_limit.
        """
        if self._end_reason is None:
            self._end_reason = reason
        self._queue.close()

    async def _send_json(self, payload: dict) -> None:
        """Send one JSON message to the browser, ignoring a browser that has already gone.

        Args:
            payload (dict): The message to send.
        """
        if self._browser_gone:
            return
        try:
            await self._ws.send_text(json.dumps(payload))
        except (WebSocketDisconnect, RuntimeError):
            self._browser_gone = True

    async def _send_bytes(self, data: bytes) -> None:
        """Send one chunk of interviewer audio to the browser, ignoring a browser that has gone.

        Args:
            data (bytes): 24 kHz 16-bit mono PCM.
        """
        if self._browser_gone:
            return
        try:
            await self._ws.send_bytes(data)
        except (WebSocketDisconnect, RuntimeError):
            self._browser_gone = True
