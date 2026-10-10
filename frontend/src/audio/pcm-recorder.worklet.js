// Capture worklet (audio thread). Deliberately thin: it only hands each block of microphone
// samples to the main thread, where PcmChunker (pcm.ts, unit tested) converts and chunks them.
// Adapted from the ADK streaming sample's pcm-recorder-processor.js
// (https://github.com/google/adk-docs, Apache License 2.0).
class PcmRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const mono = inputs[0] && inputs[0][0];
    if (mono) {
      const copy = mono.slice(); // the engine reuses its buffer, so send a copy
      this.port.postMessage(copy.buffer, [copy.buffer]);
    }
    return true; // keep the node alive
  }
}

registerProcessor("pcm-recorder", PcmRecorder);
