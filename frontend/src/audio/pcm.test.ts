import { describe, expect, it } from "vitest";
import { CHUNK_SAMPLES, PcmChunker, floatToInt16 } from "./pcm";

describe("floatToInt16", () => {
  it("maps the float range onto the 16-bit range", () => {
    const out = floatToInt16(new Float32Array([0, 1, -1, 0.5, -0.5]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 16383, -16384]);
  });

  it("clamps values outside -1..1", () => {
    const out = floatToInt16(new Float32Array([2, -3]));
    expect(Array.from(out)).toEqual([32767, -32768]);
  });
});

describe("PcmChunker", () => {
  it("is 640 samples (40 ms at 16 kHz) per chunk", () => {
    expect(CHUNK_SAMPLES).toBe(640);
  });

  it("emits nothing until a full chunk is collected", () => {
    const chunker = new PcmChunker();
    expect(chunker.push(new Float32Array(128))).toEqual([]);
  });

  it("emits one chunk every five 128-frame blocks", () => {
    const chunker = new PcmChunker();
    const emitted: ArrayBuffer[] = [];
    for (let i = 0; i < 5; i++) emitted.push(...chunker.push(new Float32Array(128)));
    expect(emitted).toHaveLength(1);
    expect(emitted[0].byteLength).toBe(1280);
  });

  it("keeps leftover samples for the next chunk and preserves order", () => {
    const chunker = new PcmChunker(4);
    const first = chunker.push(new Float32Array([0, 0.5, 1, -1, -0.5, 0]));
    expect(first).toHaveLength(1);
    expect(Array.from(new Int16Array(first[0]))).toEqual([0, 16383, 32767, -32768]);
    const second = chunker.push(new Float32Array([1, 1]));
    expect(Array.from(new Int16Array(second[0]))).toEqual([-16384, 0, 32767, 32767]);
  });

  it("splits one large push into several chunks", () => {
    const chunker = new PcmChunker(4);
    expect(chunker.push(new Float32Array(9))).toHaveLength(2);
  });
});
