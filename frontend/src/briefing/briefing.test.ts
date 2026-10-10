import { describe, expect, it } from "vitest";
import { emptyBriefing, MIN_JOB_DESCRIPTION_WORDS, validateBriefing } from "./briefing";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const full = { jobDescription: words(MIN_JOB_DESCRIPTION_WORDS), companySummary: "We build things.", resume: "I did things." };

describe("validateBriefing", () => {
  it("blocks submit while the briefing is empty", () => {
    const v = validateBriefing(emptyBriefing);
    expect(v.canSubmit).toBe(false);
    expect(v.blank).toEqual({ jobDescription: true, companySummary: true, resume: true });
    expect(v.jobDescriptionTooShort).toBe(false);
  });

  it("treats whitespace-only fields as blank", () => {
    const v = validateBriefing({ ...full, resume: "  \n " });
    expect(v.canSubmit).toBe(false);
    expect(v.blank.resume).toBe(true);
  });

  it("flags a short job description but not a blank one", () => {
    const v = validateBriefing({ ...full, jobDescription: words(MIN_JOB_DESCRIPTION_WORDS - 1) });
    expect(v.jobDescriptionTooShort).toBe(true);
    expect(v.canSubmit).toBe(false);
  });

  it("accepts a complete briefing", () => {
    expect(validateBriefing(full)).toEqual({
      canSubmit: true,
      blank: { jobDescription: false, companySummary: false, resume: false },
      jobDescriptionTooShort: false,
    });
  });
});
