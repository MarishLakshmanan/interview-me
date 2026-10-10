"""Errors shared between the Gemini gateway and the steps that call it."""


class QuotaExceededError(Exception):
    """Gemini refused a request because the request quota is used up."""
