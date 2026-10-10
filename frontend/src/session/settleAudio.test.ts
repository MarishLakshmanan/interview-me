import { describe, expect, it, vi } from "vitest";
import { settleAudio } from "./settleAudio";

const fakePlayback = () => ({ enqueue: vi.fn(), clear: vi.fn(), stop: vi.fn() });
const fakeCapture = () => ({ stop: vi.fn() });

describe("settleAudio", () => {
  it("hands back both handles for a live attempt", async () => {
    const playback = fakePlayback();
    const capture = fakeCapture();

    const outcome = await settleAudio(Promise.resolve(playback), Promise.resolve(capture), () => true);

    expect(outcome).toEqual({ kind: "ready", playback, capture });
    expect(playback.stop).not.toHaveBeenCalled();
    expect(capture.stop).not.toHaveBeenCalled();
  });

  it("releases the microphone that arrives after the session ended during the permission prompt", async () => {
    let allow: (capture: ReturnType<typeof fakeCapture>) => void = () => undefined;
    const prompt = new Promise<ReturnType<typeof fakeCapture>>((resolve) => (allow = resolve));
    const playback = fakePlayback();
    const capture = fakeCapture();
    let sessionAlive = true;

    const pending = settleAudio(Promise.resolve(playback), prompt, () => sessionAlive);
    sessionAlive = false; // the backend dropped the connection while the prompt was open
    allow(capture); // then the candidate clicked Allow
    const outcome = await pending;

    expect(outcome).toEqual({ kind: "stale" });
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(playback.stop).toHaveBeenCalledTimes(1);
  });

  it("reports a failure with its message and releases the one that did start", async () => {
    const playback = fakePlayback();

    const outcome = await settleAudio(Promise.resolve(playback), Promise.reject(new Error("mic blocked")), () => true);

    expect(outcome).toEqual({ kind: "failed", message: "mic blocked" });
    expect(playback.stop).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain message when the failure is not an Error", async () => {
    const outcome = await settleAudio(Promise.reject("nope"), Promise.resolve(fakeCapture()), () => true);

    expect(outcome).toEqual({ kind: "failed", message: "Could not start the audio." });
  });
});
