"""The assessment step: group the finished transcript under the planned questions and have it graded."""

from typing import TYPE_CHECKING

from app.config import Settings
from app.plan import PlanError, PlannedQuestion, ask_text_model, check_briefing, plan_from_payload

if TYPE_CHECKING:
    from app.gateway import GeminiGateway

RATINGS = ["strong", "adequate", "weak"]
SPEAKER_NAMES = {"candidate": "Candidate", "interviewer": "Interviewer"}

ASSESSMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "number": {"type": "integer"},
                    "right": {"type": "array", "items": {"type": "string"}},
                    "wrong": {"type": "array", "items": {"type": "string"}},
                    "improve": {"type": "array", "items": {"type": "string"}},
                    "rating": {"type": "string", "enum": RATINGS},
                },
                "required": ["number", "right", "wrong", "improve", "rating"],
            },
        },
    },
    "required": ["summary", "questions"],
}

ASSESSMENT_PROMPT = """You assess a candidate's answers in a practice job interview and write feedback for them.

How to judge:
- The transcript is machine-made from speech. It may contain mis-hearings and short fragments in the
  wrong language (for example Spanish words from an English speaker). Be lenient on these: never mark the
  candidate down for them, and read past them to what the candidate most likely meant.
- Judge each answer against what its question tests, its strong-answer points, the job description's
  requirements and the claims on the candidate's resume.
- Grade only what was said, as written. Do not assess delivery: pace, filler words and tone are out of scope.
- Never invent anything the candidate did not say, and do not credit them with points they did not make.
- Follow-up questions and the answers to them belong to the planned question they sit under; grade the
  question as a whole.
- Do not give a numeric score or an overall grade, and do not write a rewritten "stronger answer".

For every question listed under QUESTIONS REACHED return one entry with its number and:
- right: what the candidate did well (short points; an empty list if nothing)
- wrong: what was missing, wrong or weak (short points; an empty list if nothing)
- improve: concrete ways to improve the answer (short points)
- rating: "strong", "adequate" or "weak". If the candidate did not answer the question, rate it "weak" and say so.
Also return summary: a short overall summary in plain prose, with no numbers.

JOB DESCRIPTION:
{job_description}

COMPANY SUMMARY:
{company_summary}

RESUME:
{resume}

QUESTIONS REACHED (the interview got this far; grade these):
{reached}

NOT REACHED (the interview ended before these; do not grade or mention them):
{not_reached}
"""


class AssessmentError(PlanError):
    """An assessment could not be made; the message is written for the candidate to read."""


def parse_lines(lines: object, question_count: int) -> list[dict]:
    """Check the transcript lines have the expected shape and clamp their question numbers to the plan.

    Args:
        lines (object): Raw lines from the request; each has speaker, text, question and optional cut_off.
        question_count (int): How many questions the plan has.

    Returns:
        list[dict]: Clean lines with speaker, text, question (int or None) and cut_off (bool).

    Raises:
        AssessmentError: If the lines are not a list of well-formed lines.
    """
    if not isinstance(lines, list):
        raise AssessmentError("The transcript was missing from the request.", 422)
    clean = []
    for raw in lines:
        if not isinstance(raw, dict) or raw.get("speaker") not in SPEAKER_NAMES or not isinstance(raw.get("text"), str):
            raise AssessmentError("The transcript in the request was not in the expected shape.", 422)
        question = raw.get("question")
        if isinstance(question, bool) or not isinstance(question, int) or question < 1:
            question = None
        else:
            question = min(question, question_count)
        clean.append(
            {"speaker": raw["speaker"], "text": raw["text"].strip(), "question": question,
             "cut_off": raw.get("cut_off") is True}
        )
    return clean


def group_lines_by_question(lines: list[dict], reached: int) -> dict[int, list[dict]]:
    """Put each finished line under the planned question it was said during.

    Args:
        lines (list[dict]): Clean lines from `parse_lines`.
        reached (int): The last planned question the interview got to.

    Returns:
        dict[int, list[dict]]: Question number to its lines in order, for questions 1 to `reached`;
            empty lines are dropped, as are lines said before the first question.
    """
    groups: dict[int, list[dict]] = {number: [] for number in range(1, reached + 1)}
    for item in lines:
        if item["question"] in groups and item["text"]:
            groups[item["question"]].append(item)
    return groups


def format_question_block(number: int, question: PlannedQuestion, lines: list[dict]) -> str:
    """Write one reached question, with what it tests, its strong-answer points and what was said under it.

    Args:
        number (int): The question's number in the plan.
        question (PlannedQuestion): The planned question.
        lines (list[dict]): The lines said under it.

    Returns:
        str: A text block for the prompt.
    """
    points = "\n".join(f"  - {point}" for point in question.good_answer)
    said = "\n".join(
        f"  {SPEAKER_NAMES[item['speaker']]}: {item['text']}" + (" [interviewer was cut off]" if item["cut_off"] else "")
        for item in lines
    ) or "  (nothing was said under this question)"
    return (
        f"Question {number} ({question.kind}): {question.text}\n"
        f"Tests: {question.tests}\nStrong answer covers:\n{points}\nTranscript:\n{said}"
    )


def build_assessment_prompt(
    fields: dict[str, str], plan: list[PlannedQuestion], groups: dict[int, list[dict]]
) -> str:
    """Fill the assessment prompt with the briefing, the reached questions and the not-reached ones.

    Args:
        fields (dict[str, str]): The checked briefing fields.
        plan (list[PlannedQuestion]): The plan.
        groups (dict[int, list[dict]]): Lines for each reached question, from `group_lines_by_question`.

    Returns:
        str: The prompt text.
    """
    reached = "\n\n".join(format_question_block(n, plan[n - 1], lines) for n, lines in groups.items())
    not_reached = "\n".join(f"Question {n}" for n in range(len(groups) + 1, len(plan) + 1)) or "(none)"
    return ASSESSMENT_PROMPT.format(**fields, reached=reached, not_reached=not_reached)


def string_list(value: object, number: int, name: str) -> list[str]:
    """Read a list of short points from the model's reply.

    Args:
        value (object): The raw value for one of right, wrong or improve.
        number (int): The question number, for the error message.
        name (str): The field name, for the error message.

    Returns:
        list[str]: The non-blank points.

    Raises:
        ValueError: If the value is not a list of strings.
    """
    if not isinstance(value, list) or not all(isinstance(point, str) for point in value):
        raise ValueError(f"question {number} has no usable {name}.")
    return [point.strip() for point in value if point.strip()]


def merge_reply(reply: dict, plan: list[PlannedQuestion], groups: dict[int, list[dict]]) -> dict:
    """Check the model's reply covers every reached question and combine it with the plan and lines.

    Args:
        reply (dict): The model's structured reply.
        plan (list[PlannedQuestion]): The plan.
        groups (dict[int, list[dict]]): Lines for each reached question.

    Returns:
        dict: summary, questions (one per reached question, in order) and not_reached.

    Raises:
        ValueError: If the summary is blank or a reached question is missing or malformed.
    """
    summary = reply.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError("the summary is missing.")
    graded = {item.get("number"): item for item in reply.get("questions") or [] if isinstance(item, dict)}
    questions = []
    for number, lines in groups.items():
        item = graded.get(number)
        if item is None:
            raise ValueError(f"question {number} was not graded.")
        if item.get("rating") not in RATINGS:
            raise ValueError(f"question {number} has no valid rating.")
        planned = plan[number - 1]
        questions.append(
            {
                "number": number,
                "text": planned.text,
                "kind": planned.kind,
                "tests": planned.tests,
                "rating": item["rating"],
                "right": string_list(item.get("right"), number, "right"),
                "wrong": string_list(item.get("wrong"), number, "wrong"),
                "improve": string_list(item.get("improve"), number, "improve"),
                "lines": [{"speaker": x["speaker"], "text": x["text"], "cut_off": x["cut_off"]} for x in lines],
            }
        )
    not_reached = [{"number": n, "text": plan[n - 1].text} for n in range(len(groups) + 1, len(plan) + 1)]
    return {"summary": summary.strip(), "questions": questions, "not_reached": not_reached}


async def build_assessment(gateway: "GeminiGateway", settings: Settings, request: dict) -> dict:
    """Assess a finished interview with one text-model call (no retries); nothing is stored.

    Args:
        gateway (GeminiGateway): How the backend reaches Gemini.
        settings (Settings): Holds the text model id.
        request (dict): briefing (job_description, company_summary, resume), plan (questions with
            strong-answer points), lines (speaker, text, question, cut_off) and reached (last question number).

    Returns:
        dict: summary, questions (rating, right, wrong, improve and lines per reached question) and not_reached.

    Raises:
        AssessmentError: If the request is malformed, the candidate said nothing, the quota is used up,
            or the model's reply is not usable.
    """
    briefing, raw_plan = request.get("briefing"), request.get("plan")
    if not isinstance(briefing, dict) or not isinstance(raw_plan, list):
        raise AssessmentError("The briefing and the plan are needed to write an assessment.", 422)
    fields = check_briefing(briefing)
    try:
        plan = plan_from_payload(raw_plan)
    except ValueError as error:
        raise AssessmentError(f"The question plan in the request was not usable ({error})", 422) from error
    lines = parse_lines(request.get("lines"), len(plan))
    reached = request.get("reached")
    reached = 0 if isinstance(reached, bool) or not isinstance(reached, int) else min(max(reached, 0), len(plan))

    groups = group_lines_by_question(lines, reached)
    if not any(item["speaker"] == "candidate" for group in groups.values() for item in group):
        raise AssessmentError("There is nothing to assess: the candidate did not answer any question.", 422)

    prompt = build_assessment_prompt(fields, plan, groups)
    reply = await ask_text_model(gateway, settings, prompt, ASSESSMENT_SCHEMA)
    try:
        return merge_reply(reply, plan, groups)
    except ValueError as error:
        raise AssessmentError(f"The model did not return a usable assessment ({error}) Please try again.", 502) from error
