import type { Capture } from "../audio/capture";
import type { Playback } from "../audio/playback";

/** What came of starting playback and microphone capture for one interview attempt. */
export type AudioOutcome =
  | { kind: "ready"; playback: Playback; capture: Capture }
  | { kind: "failed"; message: string }
  /** The attempt ended while the permission prompt was open; whatever was acquired is already released. */
  | { kind: "stale" };

/**
 * Wait for playback and microphone capture, and never leave either one running for a dead attempt.
 * The microphone permission prompt can stay open for a long time; if the interview ended, failed or
 * was torn down meanwhile, the late microphone must be released at once instead of stored.
 *
 * @param playback The pending playback start.
 * @param capture The pending microphone start.
 * @param isCurrent Tells whether this start attempt is still the live one.
 * @returns "ready" with both handles, "failed" with a plain message (the one that did start is released),
 *   or "stale" (both released).
 */
export async function settleAudio(
  playback: Promise<Playback>,
  capture: Promise<Capture>,
  isCurrent: () => boolean,
): Promise<AudioOutcome> {
  const [pb, cap] = await Promise.allSettled([playback, capture]);
  const release = () => {
    if (pb.status === "fulfilled") pb.value.stop();
    if (cap.status === "fulfilled") cap.value.stop();
  };
  if (!isCurrent()) {
    release();
    return { kind: "stale" };
  }
  if (pb.status === "fulfilled" && cap.status === "fulfilled") {
    return { kind: "ready", playback: pb.value, capture: cap.value };
  }
  release();
  const failure = pb.status === "rejected" ? pb : cap;
  const reason = failure.status === "rejected" ? failure.reason : null;
  return { kind: "failed", message: reason instanceof Error ? reason.message : "Could not start the audio." };
}
