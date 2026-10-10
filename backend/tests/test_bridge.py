"""Tests for how InterviewBridge turns ADK live events into browser messages and an ending."""

import asyncio
import json
from types import SimpleNamespace

from app.bridge import InterviewBridge, TranscriptLine
from app.config import Settings

SETTINGS = Settings(live_model="m", voice="v", max_interview_seconds=60, goodbye_grace_seconds=60)


class FakeWebSocket:
    """Records what the bridge sends, in place of a real browser connection."""

    def __init__(self) -> None:
        """Start with nothing sent."""
        self.texts: list[dict] = []
        self.audio: list[bytes] = []

    async def send_text(self, text: str) -> None:
        """Record a JSON text frame.

        Args:
            text (str): The frame as sent.
        """
        self.texts.append(json.loads(text))

    async def send_bytes(self, data: bytes) -> None:
        """Record a binary frame.

        Args:
            data (bytes): The frame as sent.
        """
        self.audio.append(data)


def make_event(**fields) -> SimpleNamespace:
    """Build a stand-in for an ADK event with everything unset except the given fields.

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


def call(name: str, **args) -> SimpleNamespace:
    """Build a stand-in for a model function call.

    Args:
        name (str): The tool name.
        **args: The tool arguments.

    Returns:
        SimpleNamespace: An object with `name` and `args`.
    """
    return SimpleNamespace(name=name, args=args)


def run_events(events: list) -> tuple[InterviewBridge, FakeWebSocket]:
    """Feed events through a bridge and return it with the fake browser.

    Args:
        events (list): Events to handle, in order.

    Returns:
        tuple[InterviewBridge, FakeWebSocket]: The bridge afterwards, and what it sent.
    """
    websocket = FakeWebSocket()
    bridge = InterviewBridge(websocket, SETTINGS, ["Q1", "Q2"])

    async def feed() -> None:
        for event in events:
            await bridge._handle_event(event)

    asyncio.run(feed())
    return bridge, websocket


def test_only_final_transcription_enters_the_transcript() -> None:
    """Partial fragments are shown live but only finished lines are kept."""
    partial = make_event(output_transcription=SimpleNamespace(text="Tell me"), partial=True)
    final = make_event(output_transcription=SimpleNamespace(text="Tell me about yourself."))
    bridge, websocket = run_events([partial, final])

    assert [m["final"] for m in websocket.texts] == [False, True]
    assert bridge._transcript == [TranscriptLine("interviewer", "Tell me about yourself.")]


def test_candidate_and_interviewer_are_attributed() -> None:
    """Input transcription is the candidate; output transcription is the interviewer."""
    event = make_event(
        input_transcription=SimpleNamespace(text="I built a payments service."),
        output_transcription=SimpleNamespace(text="Nice."),
    )
    bridge, _ = run_events([event])

    assert {line.speaker for line in bridge._transcript} == {"candidate", "interviewer"}


def test_interruption_and_question_are_forwarded() -> None:
    """The browser must hear about interruptions and question changes."""
    bridge, websocket = run_events([make_event(interrupted=True), make_event(calls=[call("next_question", question_number=2)])])

    assert {"type": "interrupted"} in websocket.texts
    assert {"type": "question", "number": 2} in websocket.texts


def test_empty_turn_complete_after_end_tool_does_not_end_the_interview() -> None:
    """ADK fires an empty turn_complete after a tool call; the goodbye has not been spoken yet."""
    bridge, _ = run_events([make_event(calls=[call("end_interview")]), make_event(turn_complete=True)])

    assert bridge._end_reason is None


def test_interview_ends_once_the_goodbye_has_been_spoken() -> None:
    """After end_interview, the next turn_complete following spoken words ends it as completed."""
    bridge, _ = run_events(
        [
            make_event(calls=[call("end_interview")]),
            make_event(turn_complete=True),
            make_event(output_transcription=SimpleNamespace(text="Thank you, that's the end.")),
            make_event(turn_complete=True),
        ]
    )

    assert bridge._end_reason == "completed"


def test_first_end_reason_wins() -> None:
    """A late time limit must not overwrite why the interview really ended."""
    bridge, _ = run_events([])
    bridge._finish("candidate")
    bridge._finish("time_limit")

    assert bridge._end_reason == "candidate"
