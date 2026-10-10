"""Settings for the backend, read from environment variables (and backend/.env if present)."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()
# Use the Gemini Developer API (AI Studio key), not Vertex AI.
os.environ.setdefault("GOOGLE_GENAI_USE_ENTERPRISE", "FALSE")


@dataclass(frozen=True)
class Settings:
    """Everything the backend needs to know from its environment.

    Attributes:
        live_model (str): Gemini Live model used by the interviewer.
        voice (str): Prebuilt voice name for the interviewer.
        max_interview_seconds (int): Hard stop for one interview, enforced by the backend.
        goodbye_grace_seconds (int): How long to wait for the closing words before closing anyway.
        text_model (str): Gemini text model used for the question plan and the assessment.
    """

    live_model: str
    voice: str
    max_interview_seconds: int
    goodbye_grace_seconds: int
    text_model: str = "gemini-3.8-flash"


def load_settings() -> Settings:
    """Read the settings from the environment, falling back to the tested defaults.

    Returns:
        Settings: The settings for this process.

    Raises:
        RuntimeError: If no API key is set, since nothing can reach Gemini without one.
    """
    if not os.environ.get("GOOGLE_API_KEY"):
        raise RuntimeError("GOOGLE_API_KEY is not set. Put it in backend/.env (see .env.example).")
    return Settings(
        live_model=os.environ.get("LIVE_MODEL", "gemini-3.8-live"),
        voice=os.environ.get("LIVE_VOICE", "Charon"),
        max_interview_seconds=int(os.environ.get("MAX_INTERVIEW_SECONDS", "1500")),
        goodbye_grace_seconds=int(os.environ.get("GOODBYE_GRACE_SECONDS", "20")),
        text_model=os.environ.get("TEXT_MODEL", "gemini-3.8-flash"),
    )
