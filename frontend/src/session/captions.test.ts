import { describe, expect, it } from "vitest";
import { applyTranscript, emptyCaptions } from "./captions";

describe("applyTranscript", () => {
  it("starts empty", () => {
    expect(emptyCaptions.candidate.text).toBe("");
    expect(emptyCaptions.interviewer.text).toBe("");
  });

  it("appends partial pieces to the current line of that speaker", () => {
    let c = applyTranscript(emptyCaptions, { speaker: "interviewer", text: "Tell me ", final: false });
    c = applyTranscript(c, { speaker: "interviewer", text: "about yourself", final: false });
    expect(c.interviewer).toEqual({ text: "Tell me about yourself", final: false });
    expect(c.candidate.text).toBe("");
  });

  it("replaces the line with the final text and marks it final", () => {
    let c = applyTranscript(emptyCaptions, { speaker: "candidate", text: "I am", final: false });
    c = applyTranscript(c, { speaker: "candidate", text: "I am an engineer.", final: true });
    expect(c.candidate).toEqual({ text: "I am an engineer.", final: true });
  });

  it("starts a fresh line when a partial arrives after a final", () => {
    let c = applyTranscript(emptyCaptions, { speaker: "candidate", text: "Done.", final: true });
    c = applyTranscript(c, { speaker: "candidate", text: "Next", final: false });
    expect(c.candidate).toEqual({ text: "Next", final: false });
  });
});
