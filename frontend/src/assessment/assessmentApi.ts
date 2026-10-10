import { postJson, type FetchLike } from "../api/postJson";
import { ASSESSMENT_FALLBACK } from "../failures";
import type { Assessment, AssessmentRequest } from "./assessment";

export type AssessmentResult = { ok: true; assessment: Assessment } | { ok: false; message: string };

const FALLBACK = ASSESSMENT_FALLBACK;

const looksLikeAssessment = (body: any): body is Assessment =>
  typeof body?.summary === "string" &&
  Array.isArray(body.questions) &&
  body.questions.every((q: any) => !!q && typeof q.number === "number" && typeof q.rating === "string") &&
  Array.isArray(body.not_reached);

/**
 * Ask the backend to assess the finished interview. One request, never retried automatically.
 *
 * @param request The briefing, plan and tagged transcript lines.
 * @param fetchFn The fetch to use; tests pass a fake. Defaults to the browser's fetch.
 * @returns The assessment, or a message for the candidate. Never throws.
 */
export async function requestAssessment(request: AssessmentRequest, fetchFn?: FetchLike): Promise<AssessmentResult> {
  const result = await postJson("/api/assessment", request, FALLBACK, fetchFn);
  if (!result.ok) return result;
  if (looksLikeAssessment(result.body)) return { ok: true, assessment: result.body };
  return { ok: false, message: FALLBACK };
}
