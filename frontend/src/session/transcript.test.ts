import { describe, expect, it } from "vitest";
import type { ServerMessage } from "./messages";
import {
  applyServerMessage,
  emptySession,
  endReasonText,
  interviewerState,
  questionProgressText,
  transcriptToText,
  type SessionData,
} from "./transcript";

const say = (speaker: "candidate" | "interviewer", text: string, final = false): ServerMessage => ({
  type: "transcript",
  speaker,
  text,
  final,
});

/** Feed scripted backend messages through the session state, as the WebSocket would. */
const play = (...messages: ServerMessage[]): SessionData => messages.reduce(applyServerMessage, emptySession);

describe("transcript assembly", () => {
  it("starts empty", () => {
    expect(emptySession).toEqual({ lines: [], question: null, endReason: null });
  });

  it("appends partials to the in-progress line of that speaker", () => {
    const s = play(say("interviewer", "Tell me "), say("interviewer", "about yourself"));
    expect(s.lines).toEqual([{ speaker: "interviewer", text: "Tell me about yourself", final: false, cutOff: false, question: null }]);
  });

  it("replaces the in-progress line with the final text and commits it", () => {
    const s = play(say("candidate", "I am"), say("candidate", "I am an engineer.", true));
    expect(s.lines).toEqual([{ speaker: "candidate", text: "I am an engineer.", final: true, cutOff: false, question: null }]);
  });

  it("starts a new line when a partial follows a final", () => {
    const s = play(say("candidate", "Done.", true), say("candidate", "Next"));
    expect(s.lines.map((l) => [l.text, l.final])).toEqual([["Done.", true], ["Next", false]]);
  });

  it("keeps both sides as separate, ordered lines", () => {
    const s = play(say("interviewer", "Question one?", true), say("candidate", "Well"), say("candidate", "Well, I think.", true));
    expect(s.lines.map((l) => l.speaker)).toEqual(["interviewer", "candidate"]);
  });

  it("commits the right line when the sides interleave", () => {
    const s = play(say("interviewer", "So how"), say("candidate", "Sorry"), say("interviewer", "So how did you do it?", true));
    expect(s.lines.map((l) => [l.speaker, l.text, l.final])).toEqual([
      ["interviewer", "So how did you do it?", true],
      ["candidate", "Sorry", false],
    ]);
  });

  it("commits a final that arrives with no partials before it", () => {
    const s = play(say("interviewer", "Hello.", true));
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].final).toBe(true);
  });

  it("ignores messages that do not touch the transcript", () => {
    expect(play({ type: "turn_complete" }, { type: "error", message: "x" })).toEqual(emptySession);
  });
});

describe("cut-off marking", () => {
  it("marks the interviewer line in progress and keeps its text", () => {
    const s = play(say("interviewer", "Let me explain how this"), { type: "interrupted" });
    expect(s.lines).toEqual([{ speaker: "interviewer", text: "Let me explain how this", final: false, cutOff: true, question: null }]);
  });

  it("keeps the mark when the final for that line arrives afterwards", () => {
    const s = play(say("interviewer", "Let me explain"), { type: "interrupted" }, say("interviewer", "Let me explain how this works.", true));
    expect(s.lines).toEqual([{ speaker: "interviewer", text: "Let me explain how this works.", final: true, cutOff: true, question: null }]);
  });

  it("starts a new line for a partial that arrives after the cut-off", () => {
    const s = play(say("interviewer", "Let me"), { type: "interrupted" }, say("interviewer", "Sorry, go on"));
    expect(s.lines.map((l) => [l.text, l.cutOff])).toEqual([["Let me", true], ["Sorry, go on", false]]);
  });

  it("marks a just-finished interviewer line when the interruption follows its final", () => {
    const s = play(say("interviewer", "A long question.", true), { type: "interrupted" });
    expect(s.lines[0].cutOff).toBe(true);
  });

  it("does not mark an older, fully spoken interviewer line", () => {
    const s = play(say("interviewer", "Question?", true), say("candidate", "Answer.", true), { type: "interrupted" });
    expect(s.lines[0].cutOff).toBe(false);
  });

  it("does nothing when there is no interviewer line", () => {
    expect(play({ type: "interrupted" }).lines).toEqual([]);
  });
});

describe("question number", () => {
  it("follows the question messages", () => {
    expect(play({ type: "question", number: 1 }).question).toBe(1);
    expect(play({ type: "question", number: 1 }, { type: "question", number: 2 }).question).toBe(2);
  });
});

describe("ending", () => {
  it("records the reason and commits open lines, keeping cut-off marks", () => {
    const s = play(say("interviewer", "Mid-sentence"), { type: "interrupted" }, { type: "interview_ended", reason: "candidate", transcript: [] });
    expect(s.endReason).toBe("candidate");
    expect(s.lines).toEqual([{ speaker: "interviewer", text: "Mid-sentence", final: true, cutOff: true, question: null }]);
  });

  it("falls back to the backend transcript when nothing was shown", () => {
    const s = play({ type: "interview_ended", reason: "completed", transcript: [{ speaker: "interviewer", text: "Bye" }] });
    expect(s.lines).toEqual([{ speaker: "interviewer", text: "Bye", final: true, cutOff: false, question: null }]);
  });

  it("describes each reason in plain words", () => {
    expect(endReasonText("candidate")).toMatch(/you ended/i);
    expect(endReasonText("time_limit")).toMatch(/time limit/i);
    expect(endReasonText("weird")).toContain("weird");
  });
});

describe("downloadable transcript", () => {
  it("labels speakers and marks cut-off lines", () => {
    const s = play(say("interviewer", "Hello.", true), say("candidate", "Hi.", true), say("interviewer", "So tell"), { type: "interrupted" });
    expect(transcriptToText(s.lines)).toBe("Interviewer: Hello.\n\nYou: Hi.\n\nInterviewer: So tell [cut off]\n");
  });
});

describe("questionProgressText", () => {
  it("shows the number out of the plan's length", () => {
    expect(questionProgressText(3, 7)).toBe("question 3 of 7");
  });

  it("shows nothing before the first question", () => {
    expect(questionProgressText(null, 7)).toBeNull();
  });

  it("never reports a number beyond the plan", () => {
    expect(questionProgressText(9, 7)).toBe("question 7 of 7");
  });
});

describe("interviewer state", () => {
  it("is idle when not live, otherwise follows the playback buffer", () => {
    expect(interviewerState(false, true)).toBe("idle");
    expect(interviewerState(true, true)).toBe("speaking");
    expect(interviewerState(true, false)).toBe("listening");
  });
});
