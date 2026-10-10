import { useCallback, useRef, useState } from "react";
import { emptyBriefing, validateBriefing, type Briefing } from "../briefing/briefing";
import { requestPlan, type PlannedQuestion } from "../plan/planApi";

/**
 * Hold the candidate's briefing and question plan for the whole life of the page.
 * This is the one place to read them from: the interview needs the plan, and the assessment
 * (a later screen) needs both the briefing and the plan after the interview has ended.
 *
 * @returns The briefing (and its setter), the plan (null until prepared), whether one is being
 *   prepared, the last failure message, prepare() and changeBriefing().
 */
export function usePractice() {
  const [briefing, setBriefing] = useState<Briefing>(emptyBriefing);
  const [plan, setPlan] = useState<PlannedQuestion[] | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  /**
   * Ask the backend for a plan for the current briefing; the pasted text is kept either way.
   *
   * @returns The plan on success, or null if it was refused or failed (the message is in `error`).
   */
  const prepare = useCallback(async (): Promise<PlannedQuestion[] | null> => {
    if (busy.current || !validateBriefing(briefing).canSubmit) return null;
    busy.current = true;
    setPreparing(true);
    setError(null);
    const result = await requestPlan(briefing);
    busy.current = false;
    setPreparing(false);
    if (!result.ok) {
      setError(result.message);
      return null;
    }
    setPlan(result.plan);
    return result.plan;
  }, [briefing]);

  /** Go back to the briefing screen, keeping the pasted text; the plan is dropped. */
  const changeBriefing = useCallback(() => {
    setPlan(null);
    setError(null);
  }, []);

  return { briefing, setBriefing, plan, preparing, error, prepare, changeBriefing };
}
