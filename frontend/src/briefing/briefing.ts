/** The three parts of the briefing the candidate pastes before an interview. */
export interface Briefing {
  jobDescription: string;
  companySummary: string;
  resume: string;
}

export const emptyBriefing: Briefing = { jobDescription: "", companySummary: "", resume: "" };

/** Same threshold as the backend (MIN_JOB_DESCRIPTION_WORDS in backend/app/plan.py); the backend re-checks it. */
export const MIN_JOB_DESCRIPTION_WORDS = 30;

export interface BriefingValidation {
  /** True when every field is filled in and the job description is long enough. */
  canSubmit: boolean;
  blank: Record<keyof Briefing, boolean>;
  /** True when the job description has text but too few words to work from. */
  jobDescriptionTooShort: boolean;
}

/**
 * Check the briefing before any request is made, so a poor one never costs a daily model request.
 *
 * @param briefing (Briefing): The three pasted fields.
 * @returns BriefingValidation: Which fields are blank, whether the job description is too short, and whether to allow submit.
 */
export function validateBriefing(briefing: Briefing): BriefingValidation {
  const blank = {
    jobDescription: briefing.jobDescription.trim() === "",
    companySummary: briefing.companySummary.trim() === "",
    resume: briefing.resume.trim() === "",
  };
  const words = briefing.jobDescription.trim().split(/\s+/).filter(Boolean).length;
  const jobDescriptionTooShort = !blank.jobDescription && words < MIN_JOB_DESCRIPTION_WORDS;
  const canSubmit = !blank.jobDescription && !blank.companySummary && !blank.resume && !jobDescriptionTooShort;
  return { canSubmit, blank, jobDescriptionTooShort };
}
