import { useEffect, useRef, useState } from "react";
import type { Briefing } from "../briefing/briefing";
import type { PlannedQuestion } from "../plan/planApi";
import type { TranscriptEntry } from "../session/transcript";
import { assessmentDecision, buildAssessmentRequest, type Assessment } from "./assessment";
import { requestAssessment } from "./assessmentApi";

export type AssessmentState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "nothing" }
  | { phase: "ready"; assessment: Assessment }
  | { phase: "failed"; message: string };

/**
 * Ask for the assessment once, when the interview has ended, and keep its state for the report screen.
 * It is never requested again by itself, so a quota error is not retried. After a broken interview it
 * is only requested when the candidate calls `ask()`.
 *
 * @param status The interview's status.
 * @param lines The finished transcript lines.
 * @param question The question number current when the interview ended.
 * @param briefing The pasted briefing.
 * @param plan The question plan, or null before one exists.
 * @returns The assessment state (idle, loading, nothing to assess, ready or failed), whether an
 *   assessment is on offer after a break, and ask() to take that offer.
 */
export function useAssessment(
  status: string,
  lines: TranscriptEntry[],
  question: number | null,
  briefing: Briefing,
  plan: PlannedQuestion[] | null,
): { state: AssessmentState; offered: boolean; ask: () => void } {
  const [state, setState] = useState<AssessmentState>({ phase: "idle" });
  const [asked, setAsked] = useState(false);
  const requested = useRef(false);
  const base = plan ? assessmentDecision(status, lines) : "wait";
  const decision = base === "offer" && asked ? "request" : base;

  useEffect(() => {
    if (decision === "wait") {
      requested.current = false;
      setAsked(false);
      setState({ phase: "idle" });
      return;
    }
    if (decision === "offer") return;
    if (requested.current) return;
    requested.current = true;
    if (decision === "nothing") {
      setState({ phase: "nothing" });
      return;
    }
    setState({ phase: "loading" });
    void requestAssessment(buildAssessmentRequest(briefing, plan!, lines, question)).then((result) =>
      setState(result.ok ? { phase: "ready", assessment: result.assessment } : { phase: "failed", message: result.message }),
    );
    // Only the moment the decision changes matters; the lines no longer change once ended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision]);

  return { state, offered: decision === "offer", ask: () => setAsked(true) };
}
