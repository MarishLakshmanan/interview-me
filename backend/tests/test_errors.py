"""Tests for how failures are recognised as 'the free quota is used up'."""

import pytest

from app.errors import QuotaExceededError, is_quota_error, live_failure_message


class CodedError(Exception):
    """A failure that carries an HTTP-style code, like the Gemini client's API errors."""

    def __init__(self, message: str, code: int) -> None:
        """Store the message and the code.

        Args:
            message (str): The error text.
            code (int): The HTTP-style status code.
        """
        super().__init__(message)
        self.code = code


@pytest.mark.parametrize(
    "error",
    [
        QuotaExceededError("anything"),
        CodedError("something odd", 429),
        RuntimeError("429 RESOURCE_EXHAUSTED. {'error': {'message': 'Resource has been exhausted'}}"),
        RuntimeError("Live model error 429: rate limited"),
        RuntimeError("status: 429 Too Many Requests"),
        RuntimeError("You exceeded your current quota, please check your plan."),
        RuntimeError("Quota exceeded for metric generate_content_requests"),
        RuntimeError("RESOURCE_EXHAUSTED"),
    ],
)
def test_real_quota_failures_are_recognised(error: Exception) -> None:
    """Our own quota error, an HTTP 429, and quota phrases all count."""
    assert is_quota_error(error)


@pytest.mark.parametrize(
    "error",
    [
        ConnectionError("could not connect to localhost:4290"),
        ConnectionError("connection to port 429 refused"),
        RuntimeError("request id req-429-abc failed"),
        RuntimeError("received 429 bytes but expected 1000"),
        RuntimeError("socket closed 1011 for account with quota-free plan"),
        CodedError("server exploded", 500),
    ],
)
def test_incidental_429_or_quota_text_is_not_a_quota_failure(error: Exception) -> None:
    """A 429 inside another number, id or sentence, or the bare word quota, is not a quota failure."""
    assert not is_quota_error(error)


def test_live_failure_message_uses_the_quota_wording_only_for_quota_errors() -> None:
    """The candidate is only told to wait for the quota when it really is the quota."""
    assert "quota" in live_failure_message(QuotaExceededError("x")).lower()
    assert "quota" not in live_failure_message(ConnectionError("port 429 refused")).lower()
