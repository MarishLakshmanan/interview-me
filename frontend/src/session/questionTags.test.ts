import { describe, expect, it } from "vitest";
import type { ServerMessage } from "./messages";
import { applyServerMessage, emptySession } from "./transcript";

const say = (speaker: "candidate" | "interviewer", text: string, final = false): ServerMessage => ({
  type: "transcript",
  speaker,
  text,
  final,
});
const ask = (number: number): ServerMessage => ({ type: "question", number });
const play = (...messages: ServerMessage[]) => messages.reduce(applyServerMessage, emptySession);

describe("tagging lines with the planned question", () => {
  it("tags a line with the question that was current when it finished", () => {
    const s = play(
      ask(1),
      say("interviewer", "First?", true),
      say("candidate", "Answer"),
      ask(2),
      say("candidate", "Answer one.", true),
      say("interviewer", "Second?", true),
    );
    expect(s.lines.map((l) => [l.text, l.question])).toEqual([
      ["First?", 1],
      ["Answer one.", 2],
      ["Second?", 2],
    ]);
  });

  it("leaves lines before the first question untagged", () => {
    expect(play(say("interviewer", "Welcome.", true)).lines[0].question).toBeNull();
  });

  it("tags a line still open when the interview ends with the current question", () => {
    const s = play(ask(3), say("candidate", "Half an ans"), {
      type: "interview_ended",
      reason: "candidate",
      transcript: [],
    });
    expect(s.lines[0]).toMatchObject({ final: true, question: 3 });
  });
});
