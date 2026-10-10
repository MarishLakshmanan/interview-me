import { describe, expect, it } from "vitest";
import type { PlannedQuestion } from "../plan/planApi";
import { speakerLabel, type TranscriptEntry } from "../session/transcript";
import {
  assessmentDecision,
  assessmentToMarkdown,
  buildAssessmentRequest,
  type Assessment,
} from "./assessment";

const briefing = { jobDescription: "jd", companySummary: "co", resume: "cv" };
const plan: PlannedQuestion[] = [1, 2, 3].map((n) => ({
  text: `Q${n}?`,
  kind: "technical",
  tests: `skill ${n}`,
  good_answer: [`point ${n}`],
}));
const entry = (speaker: TranscriptEntry["speaker"], text: string, question: number | null): TranscriptEntry => ({
  speaker,
  text,
  final: true,
  cutOff: false,
  question,
});

describe("assessmentDecision", () => {
  const talked = [entry("interviewer", "Q1?", 1), entry("candidate", "My answer", 1)];

  it("waits while the interview has not ended", () => {
    for (const status of ["idle", "connecting", "live"] as const) {
      expect(assessmentDecision(status, talked)).toBe("wait");
    }
  });

  it("only offers an assessment after a broken interview, never requests one by itself", () => {
    expect(assessmentDecision("error", talked)).toBe("offer");
  });

  it("offers nothing after a broken interview in which the candidate said nothing", () => {
    expect(assessmentDecision("error", [entry("interviewer", "Q1?", 1)])).toBe("wait");
    expect(assessmentDecision("error", [])).toBe("wait");
  });

  it("requests an assessment once the interview has ended and the candidate answered", () => {
    expect(assessmentDecision("ended", talked)).toBe("request");
  });

  it("says there is nothing to assess, without a request, when the candidate said nothing", () => {
    expect(assessmentDecision("ended", [entry("interviewer", "Q1?", 1)])).toBe("nothing");
    expect(assessmentDecision("ended", [entry("interviewer", "Q1?", 1), entry("candidate", "  ", 1)])).toBe("nothing");
    expect(assessmentDecision("ended", [])).toBe("nothing");
  });
});

describe("buildAssessmentRequest", () => {
  it("carries the briefing, the plan with its points, each line's question and how far it got", () => {
    const lines = [entry("interviewer", "Q1?", 1), { ...entry("candidate", "Answer", 1), cutOff: true }];
    const request = buildAssessmentRequest(briefing, plan, lines, 2);
    expect(request).toEqual({
      briefing: { job_description: "jd", company_summary: "co", resume: "cv" },
      plan,
      lines: [
        { speaker: "interviewer", text: "Q1?", question: 1, cut_off: false },
        { speaker: "candidate", text: "Answer", question: 1, cut_off: true },
      ],
      reached: 2,
    });
  });

  it("treats no current question as none reached and caps at the plan's length", () => {
    expect(buildAssessmentRequest(briefing, plan, [], null).reached).toBe(0);
    expect(buildAssessmentRequest(briefing, plan, [], 9).reached).toBe(3);
  });

  it("leaves out blank lines", () => {
    const request = buildAssessmentRequest(briefing, plan, [entry("candidate", " ", 1), entry("candidate", "Hi", 1)], 1);
    expect(request.lines.map((l) => l.text)).toEqual(["Hi"]);
  });
});

describe("assessmentToMarkdown", () => {
  const assessment: Assessment = {
    summary: "Good grasp of the basics.",
    questions: [
      {
        number: 1,
        text: "Q1?",
        kind: "technical",
        tests: "skill 1",
        rating: "strong",
        right: ["Clear structure"],
        wrong: [],
        improve: ["Quantify the impact"],
        lines: [
          { speaker: "interviewer", text: "Q1?", cut_off: false },
          { speaker: "candidate", text: "I did X.", cut_off: false },
        ],
      },
    ],
    not_reached: [{ number: 2, text: "Q2?" }],
  };

  it("writes the summary, each question with rating and feedback, and the not-reached list", () => {
    const md = assessmentToMarkdown(assessment);
    expect(md).toContain("# Interview assessment");
    expect(md).toContain("Good grasp of the basics.");
    expect(md).toContain("## Question 1: Q1?");
    expect(md).toContain("Rating: Strong");
    expect(md).toContain("- Clear structure");
    expect(md).toContain("- Quantify the impact");
    expect(md).toContain("> You: I did X.");
    expect(md).toContain("## Not reached");
    expect(md).toContain("- Question 2: Q2?");
  });

  it("says plainly when a section has nothing in it, and omits not-reached when all were reached", () => {
    const md = assessmentToMarkdown({ ...assessment, not_reached: [] });
    expect(md).toContain("Nothing to note.");
    expect(md).not.toContain("Not reached");
  });

  it("labels speakers exactly as the transcript screen does (one shared mapping)", () => {
    const md = assessmentToMarkdown(assessment);
    expect(md).toContain(`> ${speakerLabel.interviewer}: Q1?`);
    expect(md).toContain(`> ${speakerLabel.candidate}: I did X.`);
  });

  it("shows no numeric score", () => {
    expect(assessmentToMarkdown(assessment)).not.toMatch(/\d+\s*\/\s*\d+|score/i);
  });
});
