import { assessmentToMarkdown, ratingLabel } from "../assessment/assessment";
import type { AssessmentState } from "../assessment/useAssessment";
import { downloadText, downloadTranscript } from "../download";
import { speakerLabel, type TranscriptEntry } from "../session/transcript";

interface Props {
  state: AssessmentState;
  lines: TranscriptEntry[];
  /** Back to the briefing screen, keeping the pasted text. */
  onNewInterview: () => void;
}

/** Screen shown after an interview: a waiting state, then the report, or a readable reason there is none. */
export function ReportScreen({ state, lines, onNewInterview }: Props) {
  return (
    <>
      <h2>Your assessment</h2>
      <p>
        <button onClick={onNewInterview}>New interview</button>
        {state.phase === "ready" && (
          <button
            onClick={() => downloadText("interview-assessment.md", assessmentToMarkdown(state.assessment), "text/markdown")}
            style={{ marginLeft: "0.5rem" }}
          >
            Download report (Markdown)
          </button>
        )}
        {lines.length > 0 && (
          <button onClick={() => downloadTranscript(lines)} style={{ marginLeft: "0.5rem" }}>
            Download transcript
          </button>
        )}
      </p>

      {state.phase === "loading" && <p role="status">Writing your assessment. This can take a little while.</p>}
      {state.phase === "nothing" && (
        <p role="status">There is nothing to assess: no answers were given, so no assessment was made.</p>
      )}
      {state.phase === "failed" && (
        <p role="alert">
          The assessment could not be made. {state.message} Your transcript is still available to download above.
        </p>
      )}
      {state.phase === "ready" && (
        <>
          <h3>Summary</h3>
          <p>{state.assessment.summary}</p>
          {state.assessment.questions.map((q) => (
            <section key={q.number} aria-label={`Question ${q.number}`}>
              <h3>
                Question {q.number}: {q.text}
              </h3>
              <p>
                <strong>Rating: {ratingLabel[q.rating]}</strong> - tests: {q.tests}
              </p>
              <Points title="What was right" points={q.right} />
              <Points title="What went wrong" points={q.wrong} />
              <Points title="How to improve" points={q.improve} />
              <details>
                <summary>What was said</summary>
                <ul>
                  {q.lines.map((line, i) => (
                    <li key={i}>
                      <strong>{speakerLabel[line.speaker]}:</strong> {line.text}
                      {line.cut_off && <em> (cut off)</em>}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          ))}
          {state.assessment.not_reached.length > 0 && (
            <section aria-label="Not reached">
              <h3>Not reached</h3>
              <p>The interview ended before these questions, so they are not graded.</p>
              <ul>
                {state.assessment.not_reached.map((q) => (
                  <li key={q.number}>
                    Question {q.number}: {q.text}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Points({ title, points }: { title: string; points: string[] }) {
  return (
    <>
      <h4>{title}</h4>
      {points.length > 0 ? (
        <ul>
          {points.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      ) : (
        <p>Nothing to note.</p>
      )}
    </>
  );
}
