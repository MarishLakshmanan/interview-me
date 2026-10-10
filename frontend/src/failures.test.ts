import { describe, expect, it } from "vitest";
import type { ServerMessage } from "./session/messages";
import { BACKEND_UNREACHABLE, CONNECTION_LOST, brokenInterviewMessage, closedConnectionMessage, endStatus } from "./failures";
import { applyServerMessage, emptySession } from "./session/transcript";

describe("endStatus", () => {
  it("treats an error ending as a failed interview, not a finished one", () => {
    expect(endStatus("error")).toBe("error");
  });

  it("treats every normal ending as finished", () => {
    for (const reason of ["completed", "candidate", "candidate_left", "time_limit"]) {
      expect(endStatus(reason)).toBe("ended");
    }
  });
});

describe("closedConnectionMessage", () => {
  it("says the backend could not be reached when the connection never opened", () => {
    expect(closedConnectionMessage(false)).toBe(BACKEND_UNREACHABLE);
    expect(BACKEND_UNREACHABLE).toMatch(/running/i);
  });

  it("says the connection was lost when it dropped after opening", () => {
    expect(closedConnectionMessage(true)).toBe(CONNECTION_LOST);
    expect(CONNECTION_LOST).toMatch(/transcript/i);
  });
});

describe("brokenInterviewMessage", () => {
  it("uses the backend's message when it sent one", () => {
    expect(brokenInterviewMessage("Wait a minute and try again.")).toBe("Wait a minute and try again.");
  });

  it("falls back to a plain sentence when the backend sent none", () => {
    expect(brokenInterviewMessage(null)).toMatch(/interview has ended/i);
  });
});

describe("transcript after a break", () => {
  it("keeps the lines shown so far when the backend ends the interview with an error", () => {
    const messages: ServerMessage[] = [
      { type: "transcript", speaker: "interviewer", text: "Tell me about yourself.", final: true },
      { type: "transcript", speaker: "candidate", text: "I am an engineer.", final: true },
      { type: "interview_ended", reason: "error", transcript: [] },
    ];
    const data = messages.reduce(applyServerMessage, emptySession);
    expect(data.lines.map((l) => l.text)).toEqual(["Tell me about yourself.", "I am an engineer."]);
    expect(data.endReason).toBe("error");
  });
});
