"""A Gemini gateway that plays a fixed script, so tests need no API key and no network."""

import asyncio
from types import SimpleNamespace

AFTER_CLOSE = object()  # script step: hold the stream until the interview has closed the session


def make_event(**fields) -> SimpleNamespace:
    """Build a stand-in for an ADK live event with everything unset except the given fields.

    Args:
        **fields: Event attributes to set, such as `output_transcription` or `turn_complete`.

    Returns:
        SimpleNamespace: An object the bridge can read like a real event.
    """
    event = SimpleNamespace(
        error_code=None, error_message=None, interrupted=False, content=None, partial=False,
        input_transcription=None, output_transcription=None, turn_complete=False, calls=[],
    )
    event.get_function_calls = lambda: event.calls
    for name, value in fields.items():
        setattr(event, name, value)
    return event


def say(speaker: str, text: str, partial: bool = False) -> SimpleNamespace:
    """Build an event carrying one transcription fragment.

    Args:
        speaker (str): "candidate" or "interviewer".
        text (str): The transcribed words.
        partial (bool, optional): True for an in-progress fragment. Defaults to False (finished line).

    Returns:
        SimpleNamespace: A live event with the matching transcription field set.
    """
    field = "input_transcription" if speaker == "candidate" else "output_transcription"
    return make_event(**{field: SimpleNamespace(text=text), "partial": partial})


def call(name: str, **args) -> SimpleNamespace:
    """Build an event in which the model calls one tool.

    Args:
        name (str): The tool name.
        **args: The tool arguments.

    Returns:
        SimpleNamespace: A live event holding that function call.
    """
    return make_event(calls=[SimpleNamespace(name=name, args=args)])


class ScriptedLiveSession:
    """Plays a fixed list of live events and records what the candidate side sent."""

    def __init__(self, script: list) -> None:
        """Set up the session.

        Args:
            script (list): Events to play in order; `AFTER_CLOSE` holds the stream until closed;
                an exception is raised from the stream at that point, like a live failure.
        """
        self._script = script
        self._closed = asyncio.Event()
        self.sent: list[tuple[str, object]] = []

    def send_text(self, text: str) -> None:
        """Record a text message sent to the model.

        Args:
            text (str): The message.
        """
        self.sent.append(("text", text))

    def send_audio(self, pcm: bytes) -> None:
        """Record a chunk of candidate audio sent to the model.

        Args:
            pcm (bytes): 16 kHz 16-bit mono PCM.
        """
        self.sent.append(("audio", pcm))

    def close(self) -> None:
        """Close the session, which lets the event stream finish."""
        self._closed.set()

    async def events(self):
        """Play the script, then stay open until closed, like a live stream does.

        Yields:
            SimpleNamespace: Each scripted live event.
        """
        for item in self._script:
            if item is AFTER_CLOSE:
                await self._closed.wait()
            elif isinstance(item, Exception):
                raise item
            else:
                yield item
        await self._closed.wait()


class ScriptedGateway:
    """Stands in for the real Gemini gateway: scripted live events, queued text-model replies."""

    def __init__(
        self,
        script: list | None = None,
        text_replies: list[dict | Exception] | None = None,
        open_error: Exception | None = None,
    ) -> None:
        """Set up the gateway.

        Args:
            script (list, optional): Live events to play. Defaults to None (an empty interview).
            text_replies (list[dict | Exception], optional): Replies for structured text calls, in order;
                an exception is raised instead of returned. Defaults to None.
            open_error (Exception, optional): Raised when a live session is opened. Defaults to None.
        """
        self._open_error = open_error
        self._script = script or []
        self._text_replies = list(text_replies or [])
        self.session: ScriptedLiveSession | None = None
        self.plan: list | None = None
        self.text_prompts: list[str] = []

    async def open_live_session(self, plan: list, settings) -> ScriptedLiveSession:
        """Open the scripted live session.

        Args:
            plan (list[PlannedQuestion]): The planned questions, kept on `self.plan` for assertions.
            settings (Settings): Backend settings (ignored).

        Returns:
            ScriptedLiveSession: The session, also kept on `self.session` for assertions.

        Raises:
            Exception: The `open_error`, if one was given.
        """
        if self._open_error:
            raise self._open_error
        self.plan = plan
        self.session = ScriptedLiveSession(self._script)
        return self.session

    async def generate_structured(self, model: str, prompt: str, schema: dict) -> dict:
        """Return the next queued reply and remember the prompt.

        Args:
            model (str): Text model id (ignored).
            prompt (str): What was asked.
            schema (dict): The requested JSON shape (ignored).

        Returns:
            dict: The next queued reply.

        Raises:
            Exception: A queued exception, raised as is, to simulate a failing model call.
        """
        self.text_prompts.append(prompt)
        reply = self._text_replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply
