export interface Playback {
  /** Queue 24 kHz 16-bit mono PCM for playback. */
  enqueue: (pcm: ArrayBuffer) => void;
  /** Empty the buffer so the interviewer stops at once. */
  clear: () => void;
  stop: () => void;
}

/**
 * Start the 24 kHz playback pipeline (ring-buffer worklet).
 * Must be called from the Start click so the browser lets the audio context run.
 *
 * @param onPlayingChange Called when sound starts or stops coming out (with a short hold on stop).
 * @returns Controls for feeding, clearing and stopping playback.
 */
export async function startPlayback(onPlayingChange: (playing: boolean) => void): Promise<Playback> {
  const context = new AudioContext({ sampleRate: 24000 });
  try {
    await context.audioWorklet.addModule(new URL("./pcm-player.worklet.js", import.meta.url));
  } catch (error) {
    void context.close();
    throw error;
  }
  const node = new AudioWorkletNode(context, "pcm-player", { outputChannelCount: [1] });
  node.port.onmessage = (event: MessageEvent<{ playing: boolean }>) => onPlayingChange(event.data.playing);
  node.connect(context.destination);

  return {
    enqueue: (pcm) => node.port.postMessage(pcm, [pcm]),
    clear: () => node.port.postMessage({ command: "clear" }),
    stop() {
      node.port.onmessage = null;
      void context.close();
    },
  };
}
