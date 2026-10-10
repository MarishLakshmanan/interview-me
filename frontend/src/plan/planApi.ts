import { postJson, type FetchLike } from "../api/postJson";
import type { Briefing } from "../briefing/briefing";

/** One planned question, as POST /api/plan returns it (backend/app/plan.py). */
export interface PlannedQuestion {
  text: string;
  kind: "opener" | "technical" | "behavioural" | "motivation";
  /** The requirement or skill the question probes. */
  tests: string;
  /** Points a strong answer would cover; kept for the assessment, never shown to the candidate. */
  good_answer: string[];
}

export type PlanResult = { ok: true; plan: PlannedQuestion[] } | { ok: false; message: string };

/** Shown next to a failed plan step where a retry is offered. */
export const DAILY_LIMIT_NOTE =
  "Preparing a plan uses one of a small number of free model requests per day, so retries may be refused until tomorrow.";

const isPlannedQuestion = (q: any): q is PlannedQuestion =>
  !!q &&
  typeof q.text === "string" &&
  typeof q.kind === "string" &&
  typeof q.tests === "string" &&
  Array.isArray(q.good_answer);

/**
 * Ask the backend to prepare the question plan for a briefing.
 *
 * @param briefing (Briefing): The three pasted fields.
 * @param fetchFn (FetchLike, optional): The fetch to use; tests pass a fake. Defaults to the browser's fetch.
 * @returns PlanResult: The plan, or a message for the candidate explaining why there is none. Never throws.
 */
export async function requestPlan(briefing: Briefing, fetchFn?: FetchLike): Promise<PlanResult> {
  const fallback = "The question plan could not be prepared. Please try again.";
  const result = await postJson(
    "/api/plan",
    { job_description: briefing.jobDescription, company_summary: briefing.companySummary, resume: briefing.resume },
    fallback,
    fetchFn,
  );
  if (!result.ok) return result;
  const questions = result.body.questions;
  if (Array.isArray(questions) && questions.every(isPlannedQuestion)) return { ok: true, plan: questions };
  return { ok: false, message: fallback };
}
