import { useInterview } from "./session/useInterview";

/** First-pass interview page: Start, a caption line per side, and an end button. */
export function App() {
  const interview = useInterview();
  const { status, captions, interviewerSpeaking, question, errorMessage } = interview;
  const running = status === "connecting" || status === "live";

  return (
    <main style={{ maxWidth: 640, margin: "3rem auto", fontFamily: "system-ui, sans-serif", padding: "0 1rem" }}>
      <h1>Interview Me</h1>
      <p>Headphones recommended.</p>

      {!running && (
        <button onClick={() => void interview.start()}>{status === "idle" ? "Start" : "Start again"}</button>
      )}
      {running && <button onClick={interview.end}>End interview</button>}

      <p>
        Status: {status}
        {running && ` - interviewer ${interviewerSpeaking ? "speaking" : "listening"}`}
        {question !== null && ` - question ${question}`}
      </p>
      {errorMessage && <p role="alert">{errorMessage}</p>}

      <p>
        <strong>Interviewer:</strong> {captions.interviewer.text}
      </p>
      <p>
        <strong>You:</strong> {captions.candidate.text}
      </p>
    </main>
  );
}
