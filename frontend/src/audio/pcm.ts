/** Samples in one microphone chunk: 40 ms at 16 kHz, as the Live API best practices recommend. */
export const CHUNK_SAMPLES = 640;

/**
 * Convert float audio (-1..1) to 16-bit signed PCM, clamping anything out of range.
 *
 * @param samples Float32 audio from the Web Audio graph.
 * @returns The same audio as Int16 samples.
 */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

/** Collects 128-frame audio blocks and cuts them into fixed-size 16-bit PCM chunks. */
export class PcmChunker {
  private pending: Int16Array;
  private filled = 0;

  /**
   * @param chunkSamples Samples per emitted chunk. Defaults to 640 (40 ms at 16 kHz).
   */
  constructor(private readonly chunkSamples: number = CHUNK_SAMPLES) {
    this.pending = new Int16Array(chunkSamples);
  }

  /**
   * Add a block of float audio and return every chunk it completes.
   *
   * @param block Float32 samples from the capture worklet.
   * @returns Zero or more chunks, each an ArrayBuffer of `chunkSamples` Int16 samples.
   */
  push(block: Float32Array): ArrayBuffer[] {
    const ints = floatToInt16(block);
    const chunks: ArrayBuffer[] = [];
    for (let i = 0; i < ints.length; i++) {
      this.pending[this.filled++] = ints[i];
      if (this.filled === this.chunkSamples) {
        chunks.push(this.pending.slice().buffer);
        this.filled = 0;
      }
    }
    return chunks;
  }
}
