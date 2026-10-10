"""Tests for the question plan endpoint and the start message, with Gemini replaced by a scripted gateway."""

import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.gateway import QuotaExceededError
from app.interviewer import build_interviewer
from app.main import create_app
from tests.scripted_gateway import ScriptedGateway, say

SETTINGS = Settings(live_model="m", voice="v", max_interview_seconds=60, goodbye_grace_seconds=60, start_wait_seconds=0.1)
KINDS = ["opener", "technical", "technical", "technical", "behavioural", "behavioural", "motivation"]
SECRET = "SECRET-STRONG-ANSWER-POINT"


def raw_question(number: int, kind: str) -> dict:
    """Build one question as the text model would return it.

    Args:
        number (int): Position of the question, used to make its text unique.
        kind (str): The question's kind.

    Returns:
        dict: A question with text, kind, tests and good_answer.
    """
    return {
        "text": f"Question number {number}?",
        "kind": kind,
        "tests": f"Skill {number}",
        "good_answer": [f"{SECRET} {number}a", f"{SECRET} {number}b"],
    }


def model_plan() -> dict:
    """Build a well-formed model reply holding seven questions.

    Returns:
        dict: The structured reply for a role the model could identify.
    """
    return {
        "cannot_identify_role": False,
        "reason": "",
        "questions": [raw_question(n, kind) for n, kind in enumerate(KINDS, start=1)],
    }


BRIEFING = {
    "job_description": "We are hiring a backend engineer to build and run payment services. " * 4,
    "company_summary": "Acme builds payments software for small shops across Europe.",
    "resume": "Senior engineer at Globex, built a ledger service in Python.",
}


def post_plan(gateway: ScriptedGateway, briefing: dict):
    """Send a briefing to the plan endpoint.

    Args:
        gateway (ScriptedGateway): The scripted Gemini gateway the app uses.
        briefing (dict): The JSON body to post.

    Returns:
        Response: The HTTP response.
    """
    client = TestClient(create_app(gateway=gateway, settings=SETTINGS))
    return client.post("/api/plan", json=briefing)


def test_plan_has_seven_questions_in_order_with_strong_answer_points() -> None:
    """A good briefing gives seven questions in the agreed order, each with all four parts."""
    gateway = ScriptedGateway(text_replies=[model_plan()])

    response = post_plan(gateway, BRIEFING)

    assert response.status_code == 200
    questions = response.json()["questions"]
    assert [q["kind"] for q in questions] == KINDS
    assert questions[0] == raw_question(1, "opener")
    assert len(gateway.text_prompts) == 1
    for field in BRIEFING.values():
        assert field.strip() in gateway.text_prompts[0]


@pytest.mark.parametrize("field", ["job_description", "company_summary", "resume"])
@pytest.mark.parametrize("value", ["", "   \n"])
def test_blank_field_is_refused_before_any_model_call(field: str, value: str) -> None:
    """Every briefing field is required, and the refusal costs no model request."""
    gateway = ScriptedGateway(text_replies=[model_plan()])

    response = post_plan(gateway, {**BRIEFING, field: value})

    assert response.status_code == 422
    assert "error" in response.json()
    assert gateway.text_prompts == []


def test_missing_field_is_refused_like_a_blank_one() -> None:
    """A field left out of the request is treated as blank."""
    gateway = ScriptedGateway(text_replies=[model_plan()])

    response = post_plan(gateway, {"job_description": BRIEFING["job_description"]})

    assert response.status_code == 422
    assert gateway.text_prompts == []


def test_short_job_description_is_refused_before_any_model_call() -> None:
    """A job description under about 30 words asks for more, with no model call."""
    gateway = ScriptedGateway(text_replies=[model_plan()])

    response = post_plan(gateway, {**BRIEFING, "job_description": "Backend engineer, Python, payments."})

    assert response.status_code == 422
    assert "30 words" in response.json()["error"]
    assert gateway.text_prompts == []


def test_unidentifiable_role_is_a_readable_message_not_a_plan() -> None:
    """When the model says it cannot identify the role, the caller gets its reason and no questions."""
    reply = {"cannot_identify_role": True, "reason": "This reads like a shopping list.", "questions": []}
    gateway = ScriptedGateway(text_replies=[reply])

    response = post_plan(gateway, BRIEFING)

    assert response.status_code == 422
    assert "shopping list" in response.json()["error"]
    assert "questions" not in response.json()


def test_quota_error_is_readable_and_not_retried() -> None:
    """A quota error says so in plain words and the model is called exactly once."""
    gateway = ScriptedGateway(text_replies=[QuotaExceededError("429"), model_plan()])

    response = post_plan(gateway, BRIEFING)

    assert response.status_code == 429
    assert "limit" in response.json()["error"].lower()
    assert len(gateway.text_prompts) == 1


def test_wrong_number_of_questions_is_reported_not_passed_on() -> None:
    """A reply that is not exactly seven questions is not returned as a plan."""
    reply = model_plan()
    reply["questions"] = reply["questions"][:5]
    gateway = ScriptedGateway(text_replies=[reply])

    response = post_plan(gateway, BRIEFING)

    assert response.status_code == 502
    assert "try again" in response.json()["error"].lower()


def run_with_first_message(first: str | bytes, gateway: ScriptedGateway) -> list[dict]:
    """Open the interview socket, send a first message, ask to end and collect the JSON replies.

    Args:
        first (str | bytes): The first frame to send.
        gateway (ScriptedGateway): The scripted Gemini gateway the app uses.

    Returns:
        list[dict]: Every JSON message received, up to and including "interview_ended".
    """
    client = TestClient(create_app(gateway=gateway, settings=SETTINGS))
    messages: list[dict] = []
    with client.websocket_connect("/ws/interview") as ws:
        if isinstance(first, bytes):
            ws.send_bytes(first)
        else:
            ws.send_text(first)
        ws.send_text(json.dumps({"type": "end"}))
        while True:
            message = json.loads(ws.receive_text())
            messages.append(message)
            if message["type"] == "interview_ended":
                return messages


def test_start_message_plan_is_used_and_strong_answers_never_reach_the_interviewer() -> None:
    """The plan from the start message drives the interview; its strong-answer points stay backend-side."""
    gateway = ScriptedGateway([say("interviewer", "Hello.")])
    start = json.dumps({"type": "start", "plan": model_plan()["questions"]})

    messages = run_with_first_message(start, gateway)

    assert messages[-1]["reason"] == "candidate"
    assert [q.text for q in gateway.plan] == [f"Question number {n}?" for n in range(1, 8)]
    assert gateway.plan[0].good_answer[0].startswith(SECRET)  # kept on the backend
    instruction = build_interviewer(gateway.plan, "m").instruction
    assert "Question number 1?" in instruction
    assert "Skill 1" in instruction
    assert SECRET not in instruction


def test_invalid_start_plan_is_reported_and_no_interview_runs() -> None:
    """A start message whose plan is malformed gets a readable error and no live session."""
    gateway = ScriptedGateway()
    client = TestClient(create_app(gateway=gateway, settings=SETTINGS))
    with client.websocket_connect("/ws/interview") as ws:
        ws.send_text(json.dumps({"type": "start", "plan": [raw_question(1, "opener")]}))
        message = json.loads(ws.receive_text())

    assert message["type"] == "error"
    assert gateway.session is None


def test_sample_plan_is_used_without_a_start_message_and_keeps_the_first_audio_frame() -> None:
    """Audio as the first message means the sample plan, in the same structure, and the frame is not lost."""
    gateway = ScriptedGateway([say("interviewer", "Hello.")])

    run_with_first_message(b"\x07\x08", gateway)

    assert [q.kind for q in gateway.plan] == KINDS
    assert all(q.text and q.tests and q.good_answer for q in gateway.plan)
    assert ("audio", b"\x07\x08") in gateway.session.sent


def test_sample_plan_is_used_when_the_browser_sends_nothing_at_first() -> None:
    """A browser that is silent at first still gets its interview, on the sample plan."""
    gateway = ScriptedGateway([say("interviewer", "Hello.")])
    client = TestClient(create_app(gateway=gateway, settings=SETTINGS))
    with client.websocket_connect("/ws/interview") as ws:
        message = json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "end"}))
        while json.loads(ws.receive_text())["type"] != "interview_ended":
            pass

    assert message["type"] == "transcript"
    assert [q.kind for q in gateway.plan] == KINDS
