import { useAssessment } from "./assessment/useAssessment";
import { usePractice } from "./practice/usePractice";
import { BriefingScreen } from "./screens/BriefingScreen";
import { InterviewScreen } from "./screens/InterviewScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { useInterview } from "./session/useInterview";

/** Page shell: the briefing screen until a plan exists, then the interview screen, then the report. */
export function App() {
  const practice = usePractice();
  const interview = useInterview();
  const { plan } = practice;
  const assessment = useAssessment(interview.status, interview.lines, interview.question, practice.briefing, plan);

  async function prepareAndStart() {
    const prepared = await practice.prepare();
    if (prepared) void interview.start(prepared);
  }

  function newInterview() {
    interview.reset();
    practice.changeBriefing();
  }

  return (
    <main style={{ maxWidth: 640, margin: "3rem auto", fontFamily: "system-ui, sans-serif", padding: "0 1rem" }}>
      <h1>Interview Me</h1>
      {plan === null ? (
        <BriefingScreen
          briefing={practice.briefing}
          onChange={practice.setBriefing}
          preparing={practice.preparing}
          error={practice.error}
          onSubmit={() => void prepareAndStart()}
        />
      ) : interview.status === "ended" ? (
        <ReportScreen state={assessment} lines={interview.lines} onNewInterview={newInterview} />
      ) : (
        <InterviewScreen
          interview={interview}
          plan={plan}
          onStartAgain={() => void interview.start(plan)}
          onChangeBriefing={practice.changeBriefing}
        />
      )}
    </main>
  );
}
