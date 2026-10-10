import { useInterview } from "./session/useInterview";
import { endReasonText, speakerLabel, transcriptToText, type TranscriptEntry } from "./session/transcript";

function downloadTranscript(lines: TranscriptEntry[]) {
  const url = URL.createObjectURL(new Blob([transcriptToText(lines)], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "interview-transcript.txt";
  link.click();
  URL.revokeObjectURL(url);
}

/** Interview page: Start, live transcript, interviewer state, question number and an end button. */
export function App() {
  const interview = useInterview();
  const { status, lines, interviewerState, question, endReason, errorMessage } = interview;
  const running = status === "connecting" || status === "live";

  return (
    <main style={{ maxWidth: 640, margin: "3rem auto", fontFamily: "system-ui, sans-serif", padding: "0 1rem" }}>
      <h1>Interview Me</h1>
      <p>Headphones recommended.</p>

      {!running && (
        <button onClick={() => void interview.start()}>{status === "idle" ? "Start" : "Start again"}</button>
      )}
      {running && <button onClick={interview.end}>End interview</button>}
      {lines.length > 0 && !running && (
        <button onClick={() => downloadTranscript(lines)} style={{ marginLeft: "0.5rem" }}>
          Download transcript
        </button>
      )}

      <p>
        Status: {status}
        {running && ` - interviewer ${interviewerState}`}
        {question !== null && ` - question ${question}`}
      </p>
      {status === "ended" && endReason && <p>{endReasonText(endReason)}</p>}
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
    </main>
  );
}
