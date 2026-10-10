// Playback worklet (audio thread): a ring buffer of 24 kHz mono samples.
//
// Adapted from the ADK streaming sample's pcm-player-processor.js
// (https://github.com/google/adk-docs, examples/python/snippets/streaming/adk-streaming-ws),
// Copyright Google LLC, licensed under the Apache License, Version 2.0
// (http://www.apache.org/licenses/LICENSE-2.0). Changes: binary Int16 input, a "clear" command
// for interruptions, silence when empty, and a "playing" report with a short hold so network
// gaps mid-sentence do not flicker the speaking state.
const HOLD_SECONDS = 0.2;

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 24000 * 180; // room for 180 s at 24 kHz
    this.buffer = new Float32Array(this.size);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.playing = false;
    this.silentFor = 0; // seconds of continuous emptiness while "playing"

    this.port.onmessage = (event) => {
      if (event.data && event.data.command === "clear") {
        this.readIndex = this.writeIndex; // interruption: drop everything queued
        return;
      }
      const samples = new Int16Array(event.data);
      for (let i = 0; i < samples.length; i++) {
        this.buffer[this.writeIndex] = samples[i] / 32768;
        this.writeIndex = (this.writeIndex + 1) % this.size;
        if (this.writeIndex === this.readIndex) {
          this.readIndex = (this.readIndex + 1) % this.size; // overflow: drop oldest
        }
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const frames = output[0].length;
    let hadAudio = false;
    for (let i = 0; i < frames; i++) {
      let sample = 0;
      if (this.readIndex !== this.writeIndex) {
        sample = this.buffer[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.size;
        hadAudio = true;
      }
      for (const channel of output) channel[i] = sample;
    }

    if (hadAudio) {
      this.silentFor = 0;
      if (!this.playing) {
        this.playing = true;
        this.port.postMessage({ playing: true });
      }
    } else if (this.playing) {
      this.silentFor += frames / sampleRate;
      if (this.silentFor >= HOLD_SECONDS) {
        this.playing = false;
        this.port.postMessage({ playing: false });
      }
    }
    return true;
  }
}

registerProcessor("pcm-player", PcmPlayer);
