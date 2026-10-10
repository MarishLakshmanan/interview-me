"""The live interviewer: its instructions, its two tools and how its agent is built."""

from google.adk.agents import Agent
from google.adk.tools import ToolContext

from app.plan import PlannedQuestion

QUESTION_KEY = "current_question"
ENDED_KEY = "interview_ended"

INSTRUCTION = """You are a professional, friendly interviewer running a practice job interview.

LANGUAGE: You speak and understand English only. Always reply in English, whatever language
you think you heard. If something is unclear or sounds like another language, ask in English
for the candidate to repeat it. Never switch language.

You have a question plan, below. Work through it in order, one question at a time, spoken in
at most two sentences. Before you speak each planned question, call the next_question tool
with that question's number (starting at 1).

After an answer, acknowledge it in one short sentence, then either ask at most one follow-up
that digs into what they said, or move to the next planned question. If the candidate says
they don't know, give one short nudge (a rephrase or a small hint) once, then move on. If they
ask you to repeat a question, repeat it plainly. Do not give feedback on how they are doing
and do not answer your own questions.

When the plan is finished, thank the candidate in one or two sentences, say the interview is
over, then call the end_interview tool.

QUESTION PLAN:
{plan}
"""


def next_question(question_number: int, tool_context: ToolContext) -> dict:
    """Record which planned question the interviewer is about to ask.

    Args:
        question_number (int): Position of the question in the plan, starting at 1.
        tool_context (ToolContext): ADK's handle for writing session state.

    Returns:
        dict: A short acknowledgement for the model.
    """
    tool_context.state[QUESTION_KEY] = question_number
    return {"status": "ok"}


def end_interview(tool_context: ToolContext) -> dict:
    """Flag that the interview has finished so the backend can close the session cleanly.

    Args:
        tool_context (ToolContext): ADK's handle for writing session state.

    Returns:
        dict: A short acknowledgement for the model.
    """
    tool_context.state[ENDED_KEY] = True
    return {"status": "ok"}


def build_interviewer(plan: list[PlannedQuestion], model: str) -> Agent:
    """Create the interviewer agent for one interview.

    Only each question's text and what it tests go into the instructions; the strong-answer
    points stay out so the live model cannot lead or coach the candidate.

    Args:
        plan (list[PlannedQuestion]): The planned questions, in the order they should be asked.
        model (str): Gemini Live model id.

    Returns:
        Agent: An ADK agent holding the instructions and the two tools.
    """
    numbered = "\n".join(
        f"{number}. {question.text}\n   (Tests: {question.tests}. Use this to choose follow-ups; never say it aloud.)"
        for number, question in enumerate(plan, start=1)
    )
    return Agent(
        name="interviewer",
        model=model,
        instruction=INSTRUCTION.format(plan=numbered),
        tools=[next_question, end_interview],
    )
