"""The one boundary through which the backend reaches Gemini, so tests can swap it for a script.

Two kinds of access live here: the live interview session (ADK, audio in and out) and
structured text-model calls (`google-genai`, used by the plan and assessment steps).
"""

import json
from collections.abc import AsyncIterator
from typing import Protocol
from uuid import uuid4

from google import genai
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.config import Settings
from app.interviewer import build_interviewer

APP_NAME = "interview-me"
USER_ID = "candidate"
INPUT_MIME = "audio/pcm;rate=16000"


class LiveSession(Protocol):
    """An open live conversation with the interviewer model."""

    def send_text(self, text: str) -> None:
        """Send a text message to the model, such as the kick-off.

        Args:
            text (str): The message.
        """

    def send_audio(self, pcm: bytes) -> None:
        """Send a chunk of candidate microphone audio to the model.

        Args:
            pcm (bytes): 16 kHz 16-bit mono PCM.
        """

    def close(self) -> None:
        """Close the session; the event stream then finishes."""

    def events(self) -> AsyncIterator:
        """Stream the model's live events until the session closes.

        Returns:
            AsyncIterator: ADK-style live events (audio, transcription, tool calls, turn state).
        """


class GeminiGateway(Protocol):
    """Everything the backend asks of Gemini."""

    async def open_live_session(self, plan: list[str], settings: Settings) -> LiveSession:
        """Open a live interview session for one interview.

        Args:
            plan (list[str]): The planned questions, in order.
            settings (Settings): Live model, voice and time limits.

        Returns:
            LiveSession: The open session.
        """

    async def generate_structured(self, model: str, prompt: str, schema: dict) -> dict:
        """Ask a text model for a JSON answer in the given shape (plan and assessment steps).

        Args:
            model (str): Text model id.
            prompt (str): What to ask.
            schema (dict): JSON schema the answer must follow.

        Returns:
            dict: The parsed JSON answer.
        """


class AdkLiveSession:
    """A live session backed by ADK's `Runner.run_live()` and a request queue."""

    def __init__(self, runner: Runner, session_id: str, run_config: RunConfig) -> None:
        """Wrap a prepared ADK runner and session.

        Args:
            runner (Runner): The ADK runner holding the interviewer agent.
            session_id (str): Id of the ADK session already created for this interview.
            run_config (RunConfig): Live options (voice, resumption, compression).
        """
        self._runner = runner
        self._session_id = session_id
        self._run_config = run_config
        self._queue = LiveRequestQueue()

    def send_text(self, text: str) -> None:
        """Send a text message to the model.

        Args:
            text (str): The message.
        """
        self._queue.send_content(types.Content(role="user", parts=[types.Part(text=text)]))

    def send_audio(self, pcm: bytes) -> None:
        """Send a chunk of candidate audio to the model.

        Args:
            pcm (bytes): 16 kHz 16-bit mono PCM.
        """
        self._queue.send_realtime(types.Blob(mime_type=INPUT_MIME, data=pcm))

    def close(self) -> None:
        """Close the request queue, which ends the live run."""
        self._queue.close()

    def events(self) -> AsyncIterator:
        """Stream live events from ADK until the queue is closed.

        Returns:
            AsyncIterator: ADK `Event` objects.
        """
        return self._runner.run_live(
            user_id=USER_ID,
            session_id=self._session_id,
            live_request_queue=self._queue,
            run_config=self._run_config,
        )


def build_run_config(voice: str) -> RunConfig:
    """Build the live session options: voice, plus the two settings a 20-minute interview needs.

    Args:
        voice (str): Prebuilt voice name for the interviewer.

    Returns:
        RunConfig: Options for ADK's live run.
    """
    return RunConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))
        ),
        # Reconnects across the ~10 minute connection limit.
        session_resumption=types.SessionResumptionConfig(),
        # Lifts the 15 minute audio-session cap; the trigger is never reached at interview length.
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=100000, sliding_window=types.SlidingWindow(target_tokens=80000)
        ),
    )


class RealGeminiGateway:
    """The production gateway: ADK for the live interview, `google-genai` for text calls."""

    async def open_live_session(self, plan: list[str], settings: Settings) -> AdkLiveSession:
        """Open a live interview session through ADK.

        Args:
            plan (list[str]): The planned questions, in order.
            settings (Settings): Live model, voice and time limits.

        Returns:
            AdkLiveSession: The session, ready to send to and stream from.
        """
        session_service = InMemorySessionService()
        runner = Runner(
            app_name=APP_NAME,
            agent=build_interviewer(plan, settings.live_model),
            session_service=session_service,
        )
        session_id = uuid4().hex
        await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=session_id)
        return AdkLiveSession(runner, session_id, build_run_config(settings.voice))

    async def generate_structured(self, model: str, prompt: str, schema: dict) -> dict:
        """Ask a Gemini text model for a JSON answer in the given shape.

        Args:
            model (str): Text model id.
            prompt (str): What to ask.
            schema (dict): JSON schema the answer must follow.

        Returns:
            dict: The parsed JSON answer.

        Raises:
            ValueError: If the model's reply is not valid JSON.
        """
        client = genai.Client()
        response = await client.aio.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json", response_json_schema=schema
            ),
        )
        try:
            return json.loads(response.text or "")
        except json.JSONDecodeError as error:
            raise ValueError(f"Model reply was not valid JSON: {error}") from error
