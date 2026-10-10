import { afterEach, describe, expect, it, vi } from "vitest";
import { startCapture } from "./capture";

/** Install a fake browser audio stack; returns the fake stream's tracks and the context's close spy. */
function fakeBrowser(addModule: () => Promise<void>) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const close = vi.fn().mockResolvedValue(undefined);
  class FakeAudioContext {
    audioWorklet = { addModule };
    close = close;
    createMediaStreamSource = () => ({ connect: () => undefined });
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", class { port = {}; });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  return { track, close };
}

afterEach(() => vi.unstubAllGlobals());

describe("startCapture", () => {
  it("stops the microphone tracks and closes the context when the worklet fails to load", async () => {
    const { track, close } = fakeBrowser(() => Promise.reject(new Error("worklet blocked")));

    await expect(startCapture(() => undefined)).rejects.toThrow("worklet blocked");

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps the microphone open and returns a handle that releases it when everything works", async () => {
    const { track, close } = fakeBrowser(() => Promise.resolve());

    const capture = await startCapture(() => undefined);
    expect(track.stop).not.toHaveBeenCalled();
    capture.stop();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
