import type { PlannedQuestion } from "../plan/planApi";
import type { useInterview } from "../session/useInterview";
import { downloadTranscript } from "../download";
import { endReasonText, questionProgressText, speakerLabel } from "../session/transcript";

interface Props {
  interview: ReturnType<typeof useInterview>;
  /** Only its length is used here; the questions themselves are never shown. */
  plan: PlannedQuestion[];
  onStartAgain: () => void;
  onChangeBriefing: () => void;
}

/** Screen for the live interview: transcript, interviewer state, question progress and the end button. */
export function InterviewScreen({ interview, plan, onStartAgain, onChangeBriefing }: Props) {
  const { status, lines, interviewerState, question, endReason, errorMessage, notice } = interview;
  const running = status === "connecting" || status === "live";
  const progress = questionProgressText(question, plan.length);

  return (
    <>
      {running && <button onClick={interview.end}>End interview</button>}
      {!running && <button onClick={onStartAgain}>Start again</button>}
      {!running && (
        <button onClick={onChangeBriefing} style={{ marginLeft: "0.5rem" }}>
          Change briefing
        </button>
      )}
      {lines.length > 0 && !running && (
        <button onClick={() => downloadTranscript(lines)} style={{ marginLeft: "0.5rem" }}>
          Download transcript
        </button>
      )}

      <p>
        Status: {status}
        {running && ` - interviewer ${interviewerState}`}
        {progress && ` - ${progress}`}
      </p>
      {status === "ended" && endReason && <p>{endReasonText(endReason)}</p>}
      {notice && <p role="status">{notice}</p>}
      {errorMessage && <p role="alert">{errorMessage}</p>}

      <ol aria-label="Transcript" style={{ listStyle: "none", padding: 0 }}>
        {lines.map((line, i) => (
          <li
            key={i}
            style={{
              margin: "0.5rem 0",
              padding: "0.5rem 0.75rem",
              borderRadius: 8,
              background: line.speaker === "interviewer" ? "#eef2ff" : "#f1f5f1",
              marginLeft: line.speaker === "candidate" ? "2rem" : 0,
              marginRight: line.speaker === "interviewer" ? "2rem" : 0,
              opacity: line.final ? 1 : 0.7,
            }}
          >
            <strong>{speakerLabel[line.speaker]}:</strong> {line.text}
            {line.cutOff && <em> (cut off)</em>}
          </li>
        ))}
      </ol>
    </>
  );
}
