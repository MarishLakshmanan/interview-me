import { awaitPermission, MicError } from "./micErrors";
import { PcmChunker } from "./pcm";

export interface Capture {
  stop: () => void;
}

/**
 * Start microphone capture at 16 kHz and deliver 40 ms 16-bit PCM chunks.
 * Must be called from the Start click so the browser lets the audio context run.
 * The microphone is never muted; it keeps streaming while the interviewer speaks.
 *
 * @param onChunk Called with each 1280-byte chunk.
 * @param onWaitingForPermission Called if the permission prompt is still unanswered after a few seconds.
 * @returns A handle whose stop() releases the microphone and the audio context.
 * @throws MicError If the microphone is blocked, missing, busy, withheld on this address or the prompt is ignored.
 */
export async function startCapture(
  onChunk: (chunk: ArrayBuffer) => void,
  onWaitingForPermission: () => void = () => {},
): Promise<Capture> {
  const context = new AudioContext({ sampleRate: 16000 });
  let stream: MediaStream;
  try {
    // The browser hides mediaDevices entirely on a page that is not a secure context (e.g. a LAN address).
    if (!navigator.mediaDevices?.getUserMedia) throw new MicError("insecure");
    stream = await awaitPermission(
      navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }),
      onWaitingForPermission,
      (late) => late.getTracks().forEach((track) => track.stop()),
    );
    await context.audioWorklet.addModule(new URL("./pcm-recorder.worklet.js", import.meta.url));
  } catch (error) {
    void context.close();
    throw error;
  }

  const node = new AudioWorkletNode(context, "pcm-recorder");
  const chunker = new PcmChunker();
  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    for (const chunk of chunker.push(new Float32Array(event.data))) onChunk(chunk);
  };
  context.createMediaStreamSource(stream).connect(node);

  return {
    stop() {
      node.port.onmessage = null;
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
