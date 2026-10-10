import type { Briefing } from "../briefing/briefing";
import type { PlannedQuestion } from "../plan/planApi";
import type { Speaker } from "../session/messages";
import type { TranscriptEntry } from "../session/transcript";

export type Rating = "strong" | "adequate" | "weak";

/** One planned question as graded, as POST /api/assessment returns it (backend/app/assessment.py). */
export interface AssessedQuestion {
  number: number;
  text: string;
  kind: string;
  tests: string;
  rating: Rating;
  right: string[];
  wrong: string[];
  improve: string[];
  /** The question, any follow-ups and the answers, in order. */
  lines: { speaker: Speaker; text: string; cut_off: boolean }[];
}

export interface Assessment {
  summary: string;
  questions: AssessedQuestion[];
  not_reached: { number: number; text: string }[];
}

/** The body POST /api/assessment takes. */
export interface AssessmentRequest {
  briefing: { job_description: string; company_summary: string; resume: string };
  plan: PlannedQuestion[];
  lines: { speaker: Speaker; text: string; question: number | null; cut_off: boolean }[];
  /** The last planned question number the interview got to; 0 if none. */
  reached: number;
}

export type AssessmentDecision = "wait" | "nothing" | "request" | "offer";

/**
 * Decide whether to ask for an assessment. This is the only gate: nothing is requested before
 * the interview has ended, and nothing is requested when the candidate said nothing. An interview
 * that broke (status "error") is only ever offered an assessment, never given one automatically,
 * because the text model's daily quota is small.
 *
 * @param status The interview's status ("ended" once the backend has said so, "error" if it broke).
 * @param lines The finished transcript lines.
 * @returns "wait" before the end (or after a break with no answers), "nothing" when an ended interview
 *   has no candidate answer, "offer" after a break with answers, otherwise "request".
 */
export function assessmentDecision(status: string, lines: TranscriptEntry[]): AssessmentDecision {
  if (status !== "ended" && status !== "error") return "wait";
  const answered = lines.some((line) => line.speaker === "candidate" && line.text.trim() !== "");
  if (status === "error") return answered ? "offer" : "wait";
  return answered ? "request" : "nothing";
}

/**
 * Build the body for the assessment endpoint from what the page holds after the interview.
 *
 * @param briefing The pasted briefing.
 * @param plan The question plan, with strong-answer points.
 * @param lines The finished transcript lines, each tagged with its question number.
 * @param question The question number current when the interview ended (null if none was reached).
 * @returns The request body; `reached` is capped at the plan's length.
 */
export function buildAssessmentRequest(
  briefing: Briefing,
  plan: PlannedQuestion[],
  lines: TranscriptEntry[],
  question: number | null,
): AssessmentRequest {
  return {
    briefing: {
      job_description: briefing.jobDescription,
      company_summary: briefing.companySummary,
      resume: briefing.resume,
    },
    plan,
    lines: lines
      .filter((line) => line.text.trim() !== "")
      .map((line) => ({ speaker: line.speaker, text: line.text, question: line.question, cut_off: line.cutOff })),
    reached: Math.min(Math.max(question ?? 0, 0), plan.length),
  };
}

/** Words for each rating, shared by the page and the downloaded file. */
export const ratingLabel: Record<Rating, string> = { strong: "Strong", adequate: "Adequate", weak: "Weak" };

const speakerName: Record<Speaker, string> = { candidate: "You", interviewer: "Interviewer" };

function bullets(points: string[]): string {
  return points.length > 0 ? points.map((point) => `- ${point}`).join("\n") : "Nothing to note.";
}

/**
 * Write the assessment as Markdown for download.
 *
 * @param assessment The assessment returned by the backend.
 * @returns The Markdown text, ending in a newline.
 */
export function assessmentToMarkdown(assessment: Assessment): string {
  const parts = ["# Interview assessment", `## Summary\n\n${assessment.summary}`];
  for (const q of assessment.questions) {
    const said = q.lines
      .map((line) => `> ${speakerName[line.speaker]}: ${line.text}${line.cut_off ? " [cut off]" : ""}`)
      .join("\n>\n");
    parts.push(
      [
        `## Question ${q.number}: ${q.text}`,
        `Rating: ${ratingLabel[q.rating]}`,
        `Tests: ${q.tests}`,
        `### What was right\n\n${bullets(q.right)}`,
        `### What went wrong\n\n${bullets(q.wrong)}`,
        `### How to improve\n\n${bullets(q.improve)}`,
        ...(said ? [`### What was said\n\n${said}`] : []),
      ].join("\n\n"),
    );
  }
  if (assessment.not_reached.length > 0) {
    parts.push(
      `## Not reached\n\nThe interview ended before these questions, so they are not graded.\n\n` +
        assessment.not_reached.map((q) => `- Question ${q.number}: ${q.text}`).join("\n"),
    );
  }
  return parts.join("\n\n") + "\n";
}
