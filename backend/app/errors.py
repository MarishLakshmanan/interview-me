"""Errors shared between the Gemini gateway and the steps that call it, and the failure text they show."""

import re

QUOTA_MESSAGE = (
    "The free Gemini quota has been used up. Wait a minute and try again; "
    "the free tier only allows a limited number of requests a day, so it may be tomorrow before it works."
)
MODEL_UNREADABLE_MESSAGE = "The model's reply could not be read. Please try again."
MODEL_UNAVAILABLE_MESSAGE = "The model could not be reached. Please try again in a moment."
LIVE_FAILURE_MESSAGE = (
    "The interviewer stopped responding, so the interview has ended. Your transcript so far is kept."
)
LIVE_QUOTA_MESSAGE = f"The interview has ended. {QUOTA_MESSAGE} Your transcript so far is kept."

# A 429 only counts as the HTTP status: at the very start of the text (how the Gemini client writes
# its API errors) or right after a word such as "status", "code" or "error" (the live stream's wording).
# Otherwise a 429 inside a port, a request id or a byte count would read as "the quota is used up".
_QUOTA_PATTERN = re.compile(
    r"^\s*429\b"
    r"|\b(?:status|code|error|http)\b\W{0,3}429\b"
    r"|resource_exhausted"
    r"|quota (?:has been |was )?exceeded"
    r"|exceeded (?:your )?(?:current )?quota"
    r"|out of quota",
    re.IGNORECASE,
)


class QuotaExceededError(Exception):
    """Gemini refused a request because the request quota is used up."""


def is_quota_error(error: BaseException) -> bool:
    """Tell whether a failure from Gemini means the free quota is used up.

    Args:
        error (BaseException): Whatever the gateway or the live stream raised.

    Returns:
        bool: True for our own quota error, an HTTP 429, or a message that names the quota.
    """
    if isinstance(error, QuotaExceededError) or getattr(error, "code", None) == 429:
        return True
    return _QUOTA_PATTERN.search(str(error)) is not None


def live_failure_message(error: BaseException) -> str:
    """Write the message the candidate sees when the live interview breaks.

    Args:
        error (BaseException): What the live stream raised.

    Returns:
        str: A plain sentence; the quota wording when the quota is used up, otherwise a general one.
    """
    return LIVE_QUOTA_MESSAGE if is_quota_error(error) else LIVE_FAILURE_MESSAGE
