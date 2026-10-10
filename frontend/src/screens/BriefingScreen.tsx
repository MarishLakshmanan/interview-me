import { validateBriefing, type Briefing } from "../briefing/briefing";
import { DAILY_LIMIT_NOTE } from "../plan/planApi";

interface Props {
  briefing: Briefing;
  onChange: (briefing: Briefing) => void;
  preparing: boolean;
  /** The readable reason the last attempt failed, or null. */
  error: string | null;
  onSubmit: () => void;
}

const FIELD_STYLE = { display: "block", width: "100%", boxSizing: "border-box", marginTop: "0.25rem" } as const;

/** Screen where the candidate pastes the briefing and asks for the question plan. */
export function BriefingScreen({ briefing, onChange, preparing, error, onSubmit }: Props) {
  const check = validateBriefing(briefing);
  const set = (field: keyof Briefing) => (e: { target: { value: string } }) =>
    onChange({ ...briefing, [field]: e.target.value });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <p>Paste the three parts of your briefing, then start. Headphones recommended.</p>

      <label>
        Job description
        <textarea rows={8} style={FIELD_STYLE} value={briefing.jobDescription} onChange={set("jobDescription")} disabled={preparing} />
      </label>
      {check.jobDescriptionTooShort && (
        <p role="status">Add more detail to the job description so the questions can fit the role.</p>
      )}

      <label>
        Company summary
        <textarea rows={4} style={FIELD_STYLE} value={briefing.companySummary} onChange={set("companySummary")} disabled={preparing} />
      </label>

      <label>
        Resume
        <textarea rows={8} style={FIELD_STYLE} value={briefing.resume} onChange={set("resume")} disabled={preparing} />
      </label>
      <p>
        Free-tier requests may be used by Google to improve its products. Remove your name and contact details from
        your resume before pasting.
      </p>

      <button type="submit" disabled={!check.canSubmit || preparing}>
        Prepare interview
      </button>

      {preparing && <p role="status">Preparing your questions... this can take up to half a minute.</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <p>{DAILY_LIMIT_NOTE}</p>
          <p>Your text is still here; edit it or press the button to try again.</p>
        </div>
      )}
    </form>
  );
}
