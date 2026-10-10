"""Tests for the interview WebSocket endpoint, with Gemini replaced by a scripted gateway."""

import json
import logging

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.scripted_gateway import AFTER_CLOSE, ScriptedGateway, call, make_event, say

SETTINGS = Settings(live_model="m", voice="v", max_interview_seconds=60, goodbye_grace_seconds=60, start_wait_seconds=0.1)


def run_interview(script: list, settings: Settings = SETTINGS, end_after: str | None = None):
    """Run one interview through the WebSocket endpoint and collect what the browser got.

    Args:
        script (list): Live events the scripted gateway plays.
        settings (Settings, optional): Backend settings. Defaults to SETTINGS.
        end_after (str, optional): Send an "end" request once a message of this type arrives.
            Defaults to None (the candidate never asks to end).

    Returns:
        tuple[list[dict], ScriptedGateway]: Every JSON message received up to and including
            "interview_ended", and the gateway (to inspect what the candidate side sent).
    """
    gateway = ScriptedGateway(script)
    client = TestClient(create_app(gateway=gateway, settings=settings))
    messages: list[dict] = []
    with client.websocket_connect("/ws/interview") as ws:
        while True:
            frame = ws.receive()
            if frame.get("text") is None:
                continue
            message = json.loads(frame["text"])
            messages.append(message)
            if message["type"] == end_after:
                ws.send_text(json.dumps({"type": "end"}))
            if message["type"] == "interview_ended":
                break
    return messages, gateway


def test_only_final_transcription_enters_the_transcript() -> None:
    """Partial fragments are shown live but only finished lines are kept."""
    messages, _ = run_interview(
        [
            say("interviewer", "Tell me", partial=True),
            say("interviewer", "Tell me about yourself."),
            call("end_interview"),
            say("interviewer", "Thanks."),
            make_event(turn_complete=True),
        ]
    )

    transcripts = [m for m in messages if m["type"] == "transcript"]
    assert [m["final"] for m in transcripts] == [False, True, True]
    assert messages[-1]["transcript"] == [
        {"speaker": "interviewer", "text": "Tell me about yourself."},
        {"speaker": "interviewer", "text": "Thanks."},
    ]


def test_candidate_and_interviewer_are_attributed() -> None:
    """Input transcription is the candidate; output transcription is the interviewer."""
    messages, _ = run_interview(
        [
            say("candidate", "I built a payments service."),
            say("interviewer", "Nice."),
            call("end_interview"),
            say("interviewer", "Bye."),
            make_event(turn_complete=True),
        ]
    )

    lines = messages[-1]["transcript"]
    assert lines[0] == {"speaker": "candidate", "text": "I built a payments service."}
    assert lines[1] == {"speaker": "interviewer", "text": "Nice."}


def test_interruption_and_question_are_forwarded() -> None:
    """The browser must hear about interruptions and question changes."""
    messages, _ = run_interview(
        [make_event(interrupted=True), call("next_question", question_number=2)], end_after="question"
    )

    assert {"type": "interrupted"} in messages
    assert {"type": "question", "number": 2} in messages


def test_empty_turn_complete_after_end_tool_does_not_end_the_interview() -> None:
    """ADK fires an empty turn_complete after a tool call; the goodbye has not been spoken yet."""
    messages, _ = run_interview([call("end_interview"), make_event(turn_complete=True)], end_after="turn_complete")

    assert messages[-1]["reason"] == "candidate"  # not "completed": only the candidate's request ended it


def test_interview_ends_once_the_goodbye_has_been_spoken() -> None:
    """After end_interview, a turn_complete following the spoken goodbye ends it as completed."""
    messages, _ = run_interview(
        [
            call("end_interview"),
            make_event(turn_complete=True),
            say("interviewer", "Thank you, that's the end."),
            make_event(turn_complete=True),
        ]
    )

    assert messages[-1]["reason"] == "completed"
    assert messages[-1]["transcript"] == [{"speaker": "interviewer", "text": "Thank you, that's the end."}]


def test_first_end_reason_wins() -> None:
    """A goodbye that finishes after the candidate already ended it must not change the reason."""
    messages, _ = run_interview(
        [
            say("interviewer", "Question one."),
            AFTER_CLOSE,
            call("end_interview"),
            say("interviewer", "Thanks, goodbye."),
            make_event(turn_complete=True),
        ],
        end_after="transcript",
    )

    assert messages[-1]["reason"] == "candidate"


def test_candidate_end_request_ends_with_that_reason() -> None:
    """Clicking end sends an "end" request; the interview ends as candidate-requested."""
    messages, _ = run_interview([say("interviewer", "Hello.")], end_after="transcript")

    assert messages[-1]["reason"] == "candidate"
    assert messages[-1]["transcript"] == [{"speaker": "interviewer", "text": "Hello."}]


def test_browser_leaving_ends_with_that_reason(caplog) -> None:
    """If the browser disconnects mid-interview the interview ends as candidate_left."""
    caplog.set_level(logging.INFO, logger="app.bridge")
    client = TestClient(create_app(gateway=ScriptedGateway([say("interviewer", "Hello.")]), settings=SETTINGS))
    with client.websocket_connect("/ws/interview") as ws:
        ws.receive_text()  # the first transcript message, then leave

    assert "Interview ended (candidate_left)" in caplog.text


def test_hard_time_limit_ends_the_interview() -> None:
    """When the time limit passes the backend ends the interview itself."""
    limited = Settings(live_model="m", voice="v", max_interview_seconds=0.2, goodbye_grace_seconds=60, start_wait_seconds=0.1)
    messages, _ = run_interview([say("interviewer", "Hello.")], settings=limited)

    assert messages[-1]["reason"] == "time_limit"


def test_candidate_side_sends_kickoff_and_microphone_audio() -> None:
    """The model gets a text kick-off first, then the candidate's audio frames."""
    gateway = ScriptedGateway([say("interviewer", "Hello.")])
    client = TestClient(create_app(gateway=gateway, settings=SETTINGS))
    with client.websocket_connect("/ws/interview") as ws:
        ws.send_bytes(b"\x01\x02")
        ws.send_text(json.dumps({"type": "end"}))
        while json.loads(ws.receive_text())["type"] != "interview_ended":
            pass

    assert gateway.session.sent[0][0] == "text"
    assert ("audio", b"\x01\x02") in gateway.session.sent
