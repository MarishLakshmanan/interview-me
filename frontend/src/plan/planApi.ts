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

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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
export async function requestPlan(briefing: Briefing, fetchFn: FetchLike = (...args) => fetch(...args)): Promise<PlanResult> {
  let response: Response;
  try {
    response = await fetchFn("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_description: briefing.jobDescription,
        company_summary: briefing.companySummary,
        resume: briefing.resume,
      }),
    });
  } catch {
    return { ok: false, message: "Could not reach the backend. Check that it is running, then try again." };
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (a proxy error page, say); handled below.
  }
  if (response.ok && body && Array.isArray(body.questions) && body.questions.every(isPlannedQuestion)) {
    return { ok: true, plan: body.questions };
  }
  if (typeof body?.error === "string" && body.error.trim()) return { ok: false, message: body.error };
  return { ok: false, message: "The question plan could not be prepared. Please try again." };
}
