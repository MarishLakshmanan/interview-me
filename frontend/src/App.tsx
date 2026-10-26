import { planToGrade } from "./assessment/assessment";
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
  // Grade against the plan the backend actually ran: the sample plan if it said it fell back to that.
  const gradedPlan = plan === null ? null : planToGrade(plan, interview.samplePlan);
  const { state: assessment, offered, ask } = useAssessment(
    interview.status,
    interview.lines,
    interview.question,
    practice.briefing,
    gradedPlan,
  );

  async function prepareAndStart() {
    const prepared = await practice.prepare();
    if (prepared) void interview.start(prepared);
  }

  function newInterview() {
    interview.reset();
    practice.changeBriefing();
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.12),transparent_60%)]">
      <header className="border-b border-zinc-800/80 bg-zinc-950/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <span className="grid size-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-50">Interview Me</h1>
            <p className="text-xs text-zinc-500">Voice mock interviews with written feedback</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
        {plan === null ? (
          <BriefingScreen
            briefing={practice.briefing}
            onChange={practice.setBriefing}
            preparing={practice.preparing}
            error={practice.error}
            onSubmit={() => void prepareAndStart()}
          />
        ) : interview.status === "ended" || assessment.phase !== "idle" ? (
          <ReportScreen
            state={assessment}
            lines={interview.lines}
            onNewInterview={newInterview}
            breakMessage={interview.status === "error" ? interview.errorMessage : null}
          />
        ) : (
          <InterviewScreen
            interview={interview}
            plan={plan}
            onStartAgain={() => void interview.start(plan)}
            onChangeBriefing={practice.changeBriefing}
            assessOffered={offered}
            onAssess={ask}
          />
        )}
      </main>
    </div>
  );
}
