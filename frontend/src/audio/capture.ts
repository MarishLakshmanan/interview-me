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
 * @returns A handle whose stop() releases the microphone and the audio context.
 * @throws If microphone permission is denied or no microphone is available.
 */
export async function startCapture(onChunk: (chunk: ArrayBuffer) => void): Promise<Capture> {
  const context = new AudioContext({ sampleRate: 16000 });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
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
