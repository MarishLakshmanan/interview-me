import { describe, expect, it } from "vitest";
import { buildStartMessage, parseServerMessage } from "./messages";

describe("buildStartMessage", () => {
  it("wraps the plan in a start message for the backend", () => {
    const plan = [{ text: "Q1", kind: "opener" as const, tests: "t", good_answer: ["a"] }];
    expect(JSON.parse(buildStartMessage(plan))).toEqual({ type: "start", plan });
  });
});

describe("parseServerMessage", () => {
  it("parses a transcript message", () => {
    const m = parseServerMessage('{"type":"transcript","speaker":"candidate","text":"hi","final":true}');
    expect(m).toEqual({ type: "transcript", speaker: "candidate", text: "hi", final: true });
  });

  it("parses the control messages", () => {
    expect(parseServerMessage('{"type":"interrupted"}')).toEqual({ type: "interrupted" });
    expect(parseServerMessage('{"type":"turn_complete"}')).toEqual({ type: "turn_complete" });
    expect(parseServerMessage('{"type":"question","number":2}')).toEqual({ type: "question", number: 2 });
    expect(parseServerMessage('{"type":"error","message":"boom"}')).toEqual({ type: "error", message: "boom" });
  });

  it("parses interview_ended with its transcript", () => {
    const m = parseServerMessage(
      '{"type":"interview_ended","reason":"completed","transcript":[{"speaker":"interviewer","text":"Bye"}]}',
    );
    expect(m).toEqual({
      type: "interview_ended",
      reason: "completed",
      transcript: [{ speaker: "interviewer", text: "Bye" }],
    });
  });

  it("returns null for invalid JSON, unknown types and bad shapes", () => {
    expect(parseServerMessage("not json")).toBeNull();
    expect(parseServerMessage('{"type":"mystery"}')).toBeNull();
    expect(parseServerMessage('{"type":"transcript","speaker":"robot","text":"x","final":true}')).toBeNull();
    expect(parseServerMessage("42")).toBeNull();
  });
});
