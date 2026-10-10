export type MicProblem = "denied" | "no-device" | "busy" | "insecure" | "timeout" | "unknown";

/** How long to wait on the permission prompt before telling the candidate we are waiting. */
export const PERMISSION_NOTICE_MS = 3000;
/** How long to wait on the permission prompt before giving up. */
export const PERMISSION_GIVE_UP_MS = 30000;

/** Shown while the permission prompt is still open. */
export const WAITING_FOR_PERMISSION_MESSAGE =
  "Waiting for microphone permission. Choose Allow in the browser prompt near the address bar.";

const MESSAGES: Record<MicProblem, string> = {
  denied:
    "Microphone access is blocked for this page. Click the lock or microphone icon in the address bar, allow the microphone, then press Start again.",
  "no-device": "No microphone was found. Plug one in or enable it, then press Start again.",
  busy: "The microphone could not be read. Another app may be using it. Close that app, then press Start again.",
  insecure:
    "The browser withholds the microphone on this address. Open the page as http://localhost:5173 (the local address) instead of the network address.",
  timeout: "The microphone permission prompt was not answered. Press Start again and choose Allow when asked.",
  unknown: "The microphone could not be started. Check it is connected, then press Start again.",
};

const PROBLEM_BY_ERROR_NAME: Record<string, MicProblem> = {
  NotAllowedError: "denied",
  SecurityError: "denied",
  NotFoundError: "no-device",
  OverconstrainedError: "no-device",
  NotReadableError: "busy",
  AbortError: "busy",
};

/** A microphone failure with a plain-language message the candidate can act on. */
export class MicError extends Error {
  readonly problem: MicProblem;

  /**
   * Build the error from a problem kind.
   *
   * @param problem (MicProblem): Which kind of microphone failure this is.
   */
  constructor(problem: MicProblem) {
    super(MESSAGES[problem]);
    this.name = "MicError";
    this.problem = problem;
  }
}

/**
 * Turn whatever getUserMedia threw into a MicError, so the UI only deals with one shape.
 *
 * @param error (unknown): The thrown value.
 * @returns MicError: The same error if already a MicError, otherwise one classified by the browser's error name.
 */
export function toMicError(error: unknown): MicError {
  if (error instanceof MicError) return error;
  const name = error instanceof Error ? error.name : "";
  return new MicError(PROBLEM_BY_ERROR_NAME[name] ?? "unknown");
}

/**
 * Wait for the browser's permission prompt without hanging forever.
 * Calls onNotice if the prompt is still open after a few seconds, and rejects with a "timeout" MicError later.
 *
 * @param pending (Promise<T>): The getUserMedia promise.
 * @param onNotice (() => void): Called once if the prompt is still unanswered after PERMISSION_NOTICE_MS.
 * @param onLate ((value: T) => void, optional): Called with the value if it arrives after we gave up, so it can be released.
 * @returns Promise<T>: The resolved value.
 * @throws MicError: Classified browser error, or "timeout" if the prompt was ignored.
 */
export function awaitPermission<T>(
  pending: Promise<T>,
  onNotice: () => void,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const noticeTimer = setTimeout(onNotice, PERMISSION_NOTICE_MS);
    const giveUpTimer = setTimeout(() => {
      done = true;
      clearTimeout(noticeTimer);
      reject(new MicError("timeout"));
    }, PERMISSION_GIVE_UP_MS);
    const finish = () => {
      clearTimeout(noticeTimer);
      clearTimeout(giveUpTimer);
    };
    pending.then(
      (value) => {
        if (done) {
          onLate?.(value);
          return;
        }
        done = true;
        finish();
        resolve(value);
      },
      (error) => {
        if (done) return;
        done = true;
        finish();
        reject(toMicError(error));
      },
    );
  });
}
