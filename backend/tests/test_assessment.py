"""Tests for the assessment endpoint, with Gemini replaced by a scripted gateway."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import QuotaExceededError
from app.main import create_app
from tests.scripted_gateway import ScriptedGateway
from tests.test_plan import BRIEFING, SECRET, model_plan

SETTINGS = Settings(live_model="m", voice="v", max_interview_seconds=60, goodbye_grace_seconds=60, start_wait_seconds=0.1)
PLAN = model_plan()["questions"]


def line(speaker: str, text: str, question: int | None, cut_off: bool = False) -> dict:
    """Build one finished transcript line as the browser sends it.

    Args:
        speaker (str): "candidate" or "interviewer".
        text (str): What was said.
        question (int | None): The planned question number current when the line finished.
        cut_off (bool, optional): True if the interviewer was interrupted. Defaults to False.

    Returns:
        dict: The line.
    """
    return {"speaker": speaker, "text": text, "question": question, "cut_off": cut_off}


def request_body(lines: list[dict], reached: int) -> dict:
    """Build an assessment request body.

    Args:
        lines (list[dict]): Finished transcript lines.
        reached (int): The last planned question number the interview got to.

    Returns:
        dict: The JSON body.
    """
    return {"briefing": BRIEFING, "plan": PLAN, "lines": lines, "reached": reached}


def model_assessment(numbers: list[int]) -> dict:
    """Build a well-formed model reply covering the given questions.

    Args:
        numbers (list[int]): Question numbers the reply should grade.

    Returns:
        dict: The structured reply.
    """
    return {
        "summary": "A solid start with room to give more detail.",
        "questions": [
            {"number": n, "right": [f"right {n}"], "wrong": [f"wrong {n}"], "improve": [f"improve {n}"],
             "rating": "adequate"}
            for n in numbers
        ],
    }


def post_assessment(gateway: ScriptedGateway, body: dict):
    """Send a request to the assessment endpoint.

    Args:
        gateway (ScriptedGateway): The scripted Gemini gateway the app uses.
        body (dict): The JSON body to post.

    Returns:
        Response: The HTTP response.
    """
    client = TestClient(create_app(gateway=gateway, settings=SETTINGS))
    return client.post("/api/assessment", json=body)


FULL_LINES = [
    line("interviewer", "Question number 1?", 1),
    line("candidate", "I am a payments engineer.", 1),
    line("interviewer", "Question number 2?", 2),
    line("candidate", "I would profile it first.", 2),
    line("interviewer", "And how would you measure that?", 2),
    line("candidate", "With tracing.", 2),
]


def test_full_interview_returns_every_question_graded_with_followups_grouped() -> None:
    """Each reached question carries its rating, feedback and the lines said under it."""
    gateway = ScriptedGateway(text_replies=[model_assessment([1, 2])])

    response = post_assessment(gateway, request_body(FULL_LINES, 2))

    assert response.status_code == 200
    result = response.json()
    assert [q["number"] for q in result["questions"]] == [1, 2]
    second = result["questions"][1]
    assert second["rating"] == "adequate"
    assert second["right"] == ["right 2"] and second["wrong"] == ["wrong 2"] and second["improve"] == ["improve 2"]
    assert [item["text"] for item in second["lines"]] == [
        "Question number 2?", "I would profile it first.", "And how would you measure that?", "With tracing.",
    ]
    assert result["not_reached"] == [{"number": n, "text": f"Question number {n}?"} for n in range(3, 8)]
    assert result["summary"]
    assert "score" not in result and "grade" not in result


def test_early_ending_assesses_only_the_questions_reached() -> None:
    """Questions beyond the last one reached are not sent for grading and are listed as not reached."""
    gateway = ScriptedGateway(text_replies=[model_assessment([1])])

    response = post_assessment(gateway, request_body(FULL_LINES[:2], 1))

    assert response.status_code == 200
    result = response.json()
    assert [q["number"] for q in result["questions"]] == [1]
    assert [q["number"] for q in result["not_reached"]] == [2, 3, 4, 5, 6, 7]
    assert f"{SECRET} 2a" not in gateway.text_prompts[0]


def test_prompt_carries_briefing_strong_answer_points_and_the_rules() -> None:
    """The model is given the briefing, the strong-answer points, and the leniency and no-delivery rules."""
    gateway = ScriptedGateway(text_replies=[model_assessment([1])])

    post_assessment(gateway, request_body(FULL_LINES[:2], 1))

    prompt = gateway.text_prompts[0]
    for field in BRIEFING.values():
        assert field.strip() in prompt
    assert f"{SECRET} 1a" in prompt
    assert "Skill 1" in prompt
    assert "I am a payments engineer." in prompt
    lowered = prompt.lower()
    assert "machine-made" in lowered and "mis-hearing" in lowered and "wrong language" in lowered
    assert "lenient" in lowered
    assert "pace" in lowered and "filler" in lowered
    assert "never invent" in lowered


def test_no_candidate_lines_means_nothing_to_assess_and_no_model_call() -> None:
    """An interview where the candidate said nothing costs no model request."""
    gateway = ScriptedGateway(text_replies=[model_assessment([1])])
    lines = [line("interviewer", "Question number 1?", 1), line("candidate", "   ", 1)]

    response = post_assessment(gateway, request_body(lines, 1))

    assert response.status_code == 422
    assert "nothing to assess" in response.json()["error"].lower()
    assert gateway.text_prompts == []


def test_quota_error_is_readable_and_not_retried() -> None:
    """A quota error says so in plain words and the model is called exactly once."""
    gateway = ScriptedGateway(text_replies=[QuotaExceededError("429"), model_assessment([1])])

    response = post_assessment(gateway, request_body(FULL_LINES[:2], 1))

    assert response.status_code == 429
    assert "wait a minute" in response.json()["error"].lower()
    assert "day" in response.json()["error"].lower()
    assert len(gateway.text_prompts) == 1


def test_model_failure_is_readable_and_not_retried() -> None:
    """Any other failure of the model call is a plain message, not a server crash, and is not retried."""
    gateway = ScriptedGateway(text_replies=[ConnectionError("dns"), model_assessment([1])])

    response = post_assessment(gateway, request_body(FULL_LINES[:2], 1))

    assert response.status_code == 502
    assert "try again" in response.json()["error"].lower()
    assert "dns" not in response.json()["error"]
    assert len(gateway.text_prompts) == 1


def test_unreadable_model_reply_is_reported_not_passed_on() -> None:
    """A reply that skips a reached question or uses an unknown rating is not returned."""
    missing = model_assessment([1])
    bad_rating = model_assessment([1, 2])
    bad_rating["questions"][0]["rating"] = "excellent"
    for reply in (missing, bad_rating):
        gateway = ScriptedGateway(text_replies=[reply])

        response = post_assessment(gateway, request_body(FULL_LINES, 2))

        assert response.status_code == 502
        assert "try again" in response.json()["error"].lower()


def test_non_object_or_oddly_shaped_model_reply_is_a_readable_502() -> None:
    """A list or string reply, an unhashable number, or a non-list questions field is not a bare 500."""
    odd_number = model_assessment([1, 2])
    odd_number["questions"][0]["number"] = [1]
    odd_questions = model_assessment([1, 2])
    odd_questions["questions"] = 5
    for reply in (["x"], "text", odd_number, odd_questions):
        gateway = ScriptedGateway(text_replies=[reply])

        response = post_assessment(gateway, request_body(FULL_LINES, 2))

        assert response.status_code == 502
        assert "try again" in response.json()["error"].lower()


@pytest.mark.parametrize("field", ["briefing", "plan", "lines"])
def test_malformed_request_is_refused_before_any_model_call(field: str) -> None:
    """A request missing its briefing, plan or lines is refused with no model call."""
    gateway = ScriptedGateway(text_replies=[model_assessment([1])])
    body = request_body(FULL_LINES[:2], 1)
    body[field] = "nope"

    response = post_assessment(gateway, body)

    assert response.status_code == 422
    assert gateway.text_prompts == []
