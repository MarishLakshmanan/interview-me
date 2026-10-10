/**
 * The page's own failure wording and the small rules that pick it, in one place.
 * Quota and model messages are written by the backend (backend/app/errors.py) and shown as sent;
 * microphone problems live in audio/micErrors.ts.
 */

/** The backend could not be reached at all (never connected, or a request failed outright). */
export const BACKEND_UNREACHABLE = "Could not reach the backend. Check that it is running, then try again.";

/** The interview connection dropped after it had opened. */
export const CONNECTION_LOST =
  "The connection to the interviewer was lost, so the interview has ended. Your transcript so far is kept.";

/** An interview that broke without the backend saying why. */
const INTERVIEW_BROKE = "The interview has ended unexpectedly. Your transcript so far is kept.";

/** Shown with a failed plan step, where a retry is offered. */
export const DAILY_LIMIT_NOTE =
  "Preparing a plan uses one of a small number of free model requests per day, so retries may be refused until tomorrow.";

export const PLAN_FALLBACK = "The question plan could not be prepared. Please try again.";

export const ASSESSMENT_FALLBACK =
  "The assessment could not be made. Please try again later; your transcript can still be downloaded.";

/** Explains why the assessment is a button after a break, not automatic. */
export const ASSESS_AFTER_BREAK_NOTE =
  "Assessing uses one of a small number of free model requests per day, so it only runs when you ask.";

/**
 * Decide whether an ended interview counts as a failure.
 *
 * @param reason The backend's end reason, such as "completed" or "error".
 * @returns "error" when the interview broke, otherwise "ended".
 */
export function endStatus(reason: string): "ended" | "error" {
  return reason === "error" ? "error" : "ended";
}

/**
 * Pick the message for a connection that closed without the backend saying the interview was over.
 *
 * @param opened True if the connection had opened before it closed.
 * @returns The backend-unreachable message if it never opened, otherwise the connection-lost message.
 */
export function closedConnectionMessage(opened: boolean): string {
  return opened ? CONNECTION_LOST : BACKEND_UNREACHABLE;
}

/**
 * Pick the message for an interview the backend ended with an error.
 *
 * @param sent The error message the backend sent just before, if any.
 * @returns The backend's message, or a plain fallback.
 */
export function brokenInterviewMessage(sent: string | null): string {
  return sent && sent.trim() ? sent : INTERVIEW_BROKE;
}
