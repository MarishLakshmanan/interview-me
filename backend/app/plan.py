"""The question plan: its shape, the sample plan, and the step that builds one from a briefing."""

from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

from app.config import Settings
from app.errors import QuotaExceededError

if TYPE_CHECKING:
    from app.gateway import GeminiGateway

PLAN_KINDS = ["opener", "technical", "technical", "technical", "behavioural", "behavioural", "motivation"]
MIN_JOB_DESCRIPTION_WORDS = 30
BRIEFING_FIELDS = {
    "job_description": "job description",
    "company_summary": "company summary",
    "resume": "resume",
}

QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "kind": {"type": "string", "enum": ["opener", "technical", "behavioural", "motivation"]},
        "tests": {"type": "string"},
        "good_answer": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["text", "kind", "tests", "good_answer"],
}

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "cannot_identify_role": {"type": "boolean"},
        "reason": {"type": "string"},
        "questions": {"type": "array", "items": QUESTION_SCHEMA},
    },
    "required": ["cannot_identify_role", "reason", "questions"],
}

PLAN_PROMPT = """You prepare a practice job interview. From the briefing below, write a question plan.

If the job description does not let you identify a real role, set cannot_identify_role to true,
explain in one plain sentence in reason, and return an empty questions list.

Otherwise return exactly seven questions in this order:
1. one opener tied to the role (kind "opener")
2. three role-specific technical questions (kind "technical")
3. two behavioural questions (kind "behavioural")
4. one question on motivation and fit with the company (kind "motivation")

Rules:
- text: the question as it will be spoken aloud, at most two sentences.
- tests: the requirement or skill from the job description the question probes, one line.
- good_answer: 2 to 4 points a strong answer would cover.
- At least two questions must anchor to specific, named items on the resume.
- Use the company summary only for the motivation question; no trivia about the company.
- Match the depth and scope of the questions to the seniority of the role.

JOB DESCRIPTION:
{job_description}

COMPANY SUMMARY:
{company_summary}

RESUME:
{resume}
"""


class PlanError(Exception):
    """A plan could not be made; the message is written for the candidate to read.

    Attributes:
        status (int): The HTTP status the endpoint should answer with.
    """

    def __init__(self, message: str, status: int) -> None:
        """Store the readable message and the status.

        Args:
            message (str): What to tell the candidate.
            status (int): The HTTP status for the endpoint.
        """
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class PlannedQuestion:
    """One entry in the question plan.

    Attributes:
        text (str): The question as spoken.
        kind (str): opener, technical, behavioural or motivation.
        tests (str): The requirement or skill it probes.
        good_answer (list[str]): What a strong answer covers; used only by the assessment.
    """

    text: str
    kind: str
    tests: str
    good_answer: list[str]


SAMPLE_PLAN = [
    PlannedQuestion(
        "Tell me about yourself and what drew you to this role.",
        "opener",
        "Fit and motivation for the role",
        ["A short, relevant career story", "A clear reason for choosing this role"],
    ),
    PlannedQuestion(
        "Describe a technically difficult problem you solved recently and how you approached it.",
        "technical",
        "Problem solving on a hard technical task",
        ["Frames the problem clearly", "Explains the options considered", "States the outcome"],
    ),
    PlannedQuestion(
        "How do you decide what to test, and what to leave untested?",
        "technical",
        "Testing judgement",
        ["Tests risk and behaviour first", "Names what is left untested and why"],
    ),
    PlannedQuestion(
        "How would you design a small service that needs to stay reliable under load?",
        "technical",
        "System design basics",
        ["Identifies failure points", "Mentions monitoring and graceful degradation"],
    ),
    PlannedQuestion(
        "Tell me about a time you disagreed with a teammate. How did you handle it?",
        "behavioural",
        "Collaboration and conflict handling",
        ["Specific situation", "Listens and seeks common ground", "Result and learning"],
    ),
    PlannedQuestion(
        "Tell me about a time a project went off track. What did you do?",
        "behavioural",
        "Ownership under pressure",
        ["Spots the problem early", "Takes concrete action", "Reflects on what changed"],
    ),
    PlannedQuestion(
        "Where do you want to grow over the next two years, and why here?",
        "motivation",
        "Motivation and fit with the company",
        ["Realistic growth goals", "Links goals to what the company offers"],
    ),
]


def plan_from_payload(questions: list) -> list[PlannedQuestion]:
    """Check a list of raw questions has the plan's shape and turn it into planned questions.

    Args:
        questions (list): Raw questions as dicts, from the text model or from a start message.

    Returns:
        list[PlannedQuestion]: Seven planned questions in the agreed order.

    Raises:
        ValueError: If the count, order of kinds or any field is wrong.
    """
    if not isinstance(questions, list) or len(questions) != len(PLAN_KINDS):
        raise ValueError(f"A plan needs exactly {len(PLAN_KINDS)} questions.")
    planned = []
    for number, (raw, kind) in enumerate(zip(questions, PLAN_KINDS), start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"Question {number} is not an object.")
        text, tests, good_answer = raw.get("text"), raw.get("tests"), raw.get("good_answer")
        if raw.get("kind") != kind:
            raise ValueError(f"Question {number} should be of kind {kind}.")
        if not isinstance(text, str) or not text.strip() or not isinstance(tests, str) or not tests.strip():
            raise ValueError(f"Question {number} needs text and tests.")
        if not isinstance(good_answer, list) or not good_answer or not all(isinstance(p, str) for p in good_answer):
            raise ValueError(f"Question {number} needs a list of strong-answer points.")
        planned.append(PlannedQuestion(text.strip(), kind, tests.strip(), good_answer))
    return planned


def plan_to_payload(plan: list[PlannedQuestion]) -> list[dict]:
    """Turn a plan into plain dicts for JSON.

    Args:
        plan (list[PlannedQuestion]): The plan.

    Returns:
        list[dict]: One dict per question with text, kind, tests and good_answer.
    """
    return [asdict(question) for question in plan]


def check_briefing(briefing: dict) -> dict[str, str]:
    """Check the briefing is complete and long enough before any model call is spent.

    Args:
        briefing (dict): Raw fields: job_description, company_summary and resume.

    Returns:
        dict[str, str]: The three fields, trimmed.

    Raises:
        PlanError: If a field is blank or the job description is under about 30 words.
    """
    fields = {}
    for key, label in BRIEFING_FIELDS.items():
        value = briefing.get(key)
        value = value.strip() if isinstance(value, str) else ""
        if not value:
            raise PlanError(f"Please fill in the {label}; all three parts of the briefing are required.", 422)
        fields[key] = value
    if len(fields["job_description"].split()) < MIN_JOB_DESCRIPTION_WORDS:
        raise PlanError(
            f"The job description is too short. Please paste more of it (at least "
            f"{MIN_JOB_DESCRIPTION_WORDS} words) so the questions can fit the role.",
            422,
        )
    return fields


async def ask_text_model(gateway: "GeminiGateway", settings: Settings, prompt: str, schema: dict) -> dict:
    """Make one structured text-model call (never retried) and turn its failures into readable errors.

    Args:
        gateway (GeminiGateway): How the backend reaches Gemini.
        settings (Settings): Holds the text model id.
        prompt (str): What to ask.
        schema (dict): JSON schema the answer must follow.

    Returns:
        dict: The model's parsed JSON answer.

    Raises:
        PlanError: If the quota is used up (429) or the reply is not valid JSON (502).
    """
    try:
        return await gateway.generate_structured(settings.text_model, prompt, schema)
    except QuotaExceededError as error:
        raise PlanError(
            "The daily request limit for the model has been reached. Please try again later.", 429
        ) from error
    except ValueError as error:
        raise PlanError("The model's reply could not be read. Please try again.", 502) from error


async def build_plan(gateway: "GeminiGateway", settings: Settings, briefing: dict) -> list[PlannedQuestion]:
    """Turn a briefing into a seven-question plan with one text-model call (no retries).

    Args:
        gateway (GeminiGateway): How the backend reaches Gemini.
        settings (Settings): Holds the text model id.
        briefing (dict): Raw fields: job_description, company_summary and resume.

    Returns:
        list[PlannedQuestion]: Seven planned questions in order.

    Raises:
        PlanError: If the briefing is refused, the role cannot be identified, the quota is used up,
            or the model's reply is not a usable plan.
    """
    fields = check_briefing(briefing)
    reply = await ask_text_model(gateway, settings, PLAN_PROMPT.format(**fields), PLAN_SCHEMA)
    if reply.get("cannot_identify_role"):
        reason = str(reply.get("reason") or "").strip()
        raise PlanError(
            f"The role could not be identified from the job description. {reason}".strip()
            + " Please paste the full job description.",
            422,
        )
    try:
        return plan_from_payload(reply.get("questions"))
    except ValueError as error:
        raise PlanError(f"The model did not return a usable plan ({error}) Please try again.", 502) from error
