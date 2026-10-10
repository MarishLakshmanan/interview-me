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
  it("tags a line with the question that was current when it was first seen, not when it finished", () => {
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
      ["Answer one.", 1],
      ["Second?", 2],
    ]);
  });

  it("keeps the answer under its question when its final arrives after the next question's event", () => {
    const s = play(
      ask(2),
      say("interviewer", "Question two?", true),
      say("candidate", "I would profile"),
      say("candidate", "I would profile it first."),
      ask(3),
      say("candidate", "I would profile it first, then fix.", true),
      say("interviewer", "Question three?"),
      say("interviewer", "Question three?", true),
    );
    expect(s.lines.map((l) => [l.speaker, l.question])).toEqual([
      ["interviewer", 2],
      ["candidate", 2],
      ["interviewer", 3],
    ]);
  });

  it("keeps an open interviewer line's tag when the next question arrives before it is finalised", () => {
    const s = play(ask(1), say("interviewer", "First"), ask(2), say("interviewer", "First question?", true));
    expect(s.lines[0].question).toBe(1);
  });

  it("tags a line that arrives as a final with no partials with the current question", () => {
    const s = play(ask(4), say("candidate", "Straight to final.", true));
    expect(s.lines[0].question).toBe(4);
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
