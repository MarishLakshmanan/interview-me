import type { ReactNode } from "react";
import { validateBriefing, type Briefing } from "../briefing/briefing";
import { DAILY_LIMIT_NOTE } from "../failures";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Spinner } from "../ui/Spinner";

interface Props {
  briefing: Briefing;
  onChange: (briefing: Briefing) => void;
  preparing: boolean;
  /** The readable reason the last attempt failed, or null. */
  error: string | null;
  onSubmit: () => void;
}

const FIELD_CLASSES =
  "mt-2 block w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60";

/** Screen where the candidate pastes the briefing and asks for the question plan. */
export function BriefingScreen({ briefing, onChange, preparing, error, onSubmit }: Props) {
  const check = validateBriefing(briefing);
  const set = (field: keyof Briefing) => (e: { target: { value: string } }) =>
    onChange({ ...briefing, [field]: e.target.value });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Set up your interview</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Paste the three parts of your briefing, then start. Headphones recommended.
        </p>
      </div>

      <Card className="space-y-5">
        <Field label="Job description" hint="The role you are practising for.">
          <textarea
            rows={8}
            className={FIELD_CLASSES}
            value={briefing.jobDescription}
            onChange={set("jobDescription")}
            disabled={preparing}
          />
        </Field>
        {check.jobDescriptionTooShort && (
          <p role="status" className="-mt-3 text-xs text-amber-300/90">
            Add more detail to the job description so the questions can fit the role.
          </p>
        )}

        <Field label="Company summary" hint="What the company does and cares about.">
          <textarea
            rows={4}
            className={FIELD_CLASSES}
            value={briefing.companySummary}
            onChange={set("companySummary")}
            disabled={preparing}
          />
        </Field>

        <Field label="Resume" hint="Your experience, as plain text.">
          <textarea rows={8} className={FIELD_CLASSES} value={briefing.resume} onChange={set("resume")} disabled={preparing} />
        </Field>
      </Card>

      <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs leading-relaxed text-zinc-400">
        Free-tier requests may be used by Google to improve its products. Remove your name and contact details from
        your resume before pasting.
      </p>

      <Button type="submit" variant="primary" className="w-full py-3 text-base" disabled={!check.canSubmit || preparing}>
        {preparing && <Spinner />}
        Prepare interview
      </Button>

      {preparing && (
        <p role="status" className="text-center text-sm text-zinc-400">
          Preparing your questions... this can take up to half a minute.
        </p>
      )}
      {error && (
        <Alert tone="error">
          <p className="font-medium">{error}</p>
          <p>{DAILY_LIMIT_NOTE}</p>
          <p className="text-rose-200/70">Your text is still here; edit it or press the button to try again.</p>
        </Alert>
      )}
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <span className="ml-2 text-xs text-zinc-500">{hint}</span>
      {children}
    </label>
  );
}
