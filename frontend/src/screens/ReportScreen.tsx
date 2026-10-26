import { assessmentToMarkdown, ratingLabel } from "../assessment/assessment";
import type { AssessmentState } from "../assessment/useAssessment";
import { downloadText, downloadTranscript } from "../download";
import { speakerLabel, type TranscriptEntry } from "../session/transcript";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Spinner } from "../ui/Spinner";

interface Props {
  state: AssessmentState;
  lines: TranscriptEntry[];
  /** Back to the briefing screen, keeping the pasted text. */
  onNewInterview: () => void;
  /** Set when the interview broke before it finished, so the report says it covers only part of it. */
  breakMessage?: string | null;
}

const RATING_CLASSES = {
  strong: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  adequate: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  weak: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
} as const;

/** Screen shown after an interview: a waiting state, then the report, or a readable reason there is none. */
export function ReportScreen({ state, lines, onNewInterview, breakMessage = null }: Props) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Your assessment</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onNewInterview}>
            New interview
          </Button>
          {state.phase === "ready" && (
            <Button
              onClick={() => downloadText("interview-assessment.md", assessmentToMarkdown(state.assessment), "text/markdown")}
            >
              Download report (Markdown)
            </Button>
          )}
          {lines.length > 0 && <Button onClick={() => downloadTranscript(lines)}>Download transcript</Button>}
        </div>
      </div>

      {breakMessage && <Alert tone="error">{breakMessage}</Alert>}

      {state.phase === "loading" && (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <Spinner className="size-7 text-indigo-400" />
          <p role="status" className="text-sm text-zinc-400">
            Writing your assessment. This can take a little while.
          </p>
        </Card>
      )}
      {state.phase === "nothing" && (
        <Card>
          <p role="status" className="text-sm text-zinc-400">
            There is nothing to assess: no answers were given, so no assessment was made.
          </p>
        </Card>
      )}
      {state.phase === "failed" && (
        <Alert tone="error">
          The assessment could not be made. {state.message} Your transcript is still available to download above.
        </Alert>
      )}
      {state.phase === "ready" && (
        <>
          <Card className="border-indigo-500/20 bg-indigo-500/5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Summary</h3>
            <p className="mt-2 leading-relaxed text-zinc-200">{state.assessment.summary}</p>
          </Card>

          {state.assessment.questions.map((q) => (
            <Card key={q.number} aria-label={`Question ${q.number}`} className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Question {q.number}</p>
                  <h3 className="mt-1 font-semibold leading-snug text-zinc-50">{q.text}</h3>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${RATING_CLASSES[q.rating]}`}
                >
                  {ratingLabel[q.rating]}
                </span>
              </div>
              <p className="text-sm text-zinc-400">
                <span className="text-zinc-500">Tests:</span> {q.tests}
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <Points title="What was right" points={q.right} accent="border-emerald-500/60 text-emerald-300" />
                <Points title="What went wrong" points={q.wrong} accent="border-rose-500/60 text-rose-300" />
                <Points title="How to improve" points={q.improve} accent="border-sky-500/60 text-sky-300" />
              </div>

              <details className="group rounded-lg border border-zinc-800 bg-zinc-950/40">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200">
                  What was said
                </summary>
                <ul className="space-y-2 border-t border-zinc-800 px-4 py-3 text-sm">
                  {q.lines.map((line, i) => (
                    <li key={i} className="leading-relaxed text-zinc-300">
                      <span className="font-medium text-zinc-100">{speakerLabel[line.speaker]}:</span> {line.text}
                      {line.cut_off && <em className="text-amber-300/80"> (cut off)</em>}
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          ))}

          {state.assessment.not_reached.length > 0 && (
            <Card aria-label="Not reached" className="border-dashed bg-transparent">
              <h3 className="font-semibold text-zinc-300">Not reached</h3>
              <p className="mt-1 text-sm text-zinc-500">The interview ended before these questions, so they are not graded.</p>
              <ul className="mt-3 space-y-1.5 text-sm text-zinc-400">
                {state.assessment.not_reached.map((q) => (
                  <li key={q.number}>
                    <span className="text-zinc-500">Question {q.number}:</span> {q.text}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Points({ title, points, accent }: { title: string; points: string[]; accent: string }) {
  return (
    <div className={`rounded-lg border-l-2 bg-zinc-950/40 px-4 py-3 ${accent}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wider">{title}</h4>
      {points.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-zinc-300 marker:text-zinc-600">
          {points.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">Nothing to note.</p>
      )}
    </div>
  );
}
