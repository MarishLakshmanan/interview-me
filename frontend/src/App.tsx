import { usePractice } from "./practice/usePractice";
import { BriefingScreen } from "./screens/BriefingScreen";
import { InterviewScreen } from "./screens/InterviewScreen";
import { useInterview } from "./session/useInterview";

/** Page shell: the briefing screen until a plan exists, then the interview screen. */
export function App() {
  const practice = usePractice();
  const interview = useInterview();
  const { plan } = practice;

  async function prepareAndStart() {
    const prepared = await practice.prepare();
    if (prepared) void interview.start(prepared);
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
