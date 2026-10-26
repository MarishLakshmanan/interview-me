import { useEffect, useRef } from "react";
import type { PlannedQuestion } from "../plan/planApi";
import type { InterviewStatus, useInterview } from "../session/useInterview";
import { ASSESS_AFTER_BREAK_NOTE } from "../failures";
import { downloadTranscript } from "../download";
import { endReasonText, questionProgressText, speakerLabel, type InterviewerState } from "../session/transcript";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

interface Props {
  interview: ReturnType<typeof useInterview>;
  /** Only its length is used here; the questions themselves are never shown. */
  plan: PlannedQuestion[];
  onStartAgain: () => void;
  onChangeBriefing: () => void;
  /** True after a broken interview in which the candidate answered: show the assess button. */
  assessOffered: boolean;
  onAssess: () => void;
}

/** Screen for the live interview: transcript, interviewer state, question progress and the end button. */
export function InterviewScreen({ interview, plan, onStartAgain, onChangeBriefing, assessOffered, onAssess }: Props) {
  const { status, lines, interviewerState, question, endReason, errorMessage, notice } = interview;
  const running = status === "connecting" || status === "live";
  const progress = questionProgressText(question, plan.length);
  const progressPercent = question === null || plan.length === 0 ? 0 : (Math.min(question, plan.length) / plan.length) * 100;

  // Keep the newest line in view as the transcript grows.
  const transcriptList = useRef<HTMLOListElement>(null);
  const lastText = lines.length > 0 ? lines[lines.length - 1].text : "";
  useEffect(() => {
    const list = transcriptList.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [lines.length, lastText]);

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={status} />
            {running && <InterviewerIndicator state={interviewerState} />}
          </div>
          <div className="flex flex-wrap gap-2">
            {running && (
              <Button variant="danger" onClick={interview.end}>
                End interview
              </Button>
            )}
            {!running && (
              <Button variant="primary" onClick={onStartAgain}>
                Start again
              </Button>
            )}
            {!running && <Button onClick={onChangeBriefing}>Change briefing</Button>}
            {assessOffered && <Button onClick={onAssess}>Assess what was said</Button>}
            {lines.length > 0 && !running && (
              <Button onClick={() => downloadTranscript(lines)}>Download transcript</Button>
            )}
          </div>
        </div>

        {progress && (
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-zinc-400">
              <span className="capitalize">{progress}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {status === "ended" && endReason && <p className="text-sm text-zinc-400">{endReasonText(endReason)}</p>}
      {notice && <Alert tone="info">{notice}</Alert>}
      {errorMessage && <Alert tone="error">{errorMessage}</Alert>}
      {assessOffered && <p className="text-sm text-zinc-400">{ASSESS_AFTER_BREAK_NOTE}</p>}

      <Card className="p-3 sm:p-4">
        {lines.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500">
            {running ? "The conversation will appear here once it starts." : "Nothing was said."}
          </p>
        ) : (
          <ol ref={transcriptList} aria-label="Transcript" className="max-h-[60vh] space-y-3 overflow-y-auto p-1">
            {lines.map((line, i) => {
              const fromInterviewer = line.speaker === "interviewer";
              return (
                <li key={i} className={`flex ${fromInterviewer ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed transition-opacity ${
                      fromInterviewer
                        ? "rounded-bl-md bg-indigo-500/15 text-indigo-50 ring-1 ring-indigo-500/20"
                        : "rounded-br-md bg-zinc-800 text-zinc-100"
                    } ${line.final ? "" : "opacity-60"}`}
                  >
                    <p className={`mb-0.5 text-xs font-medium ${fromInterviewer ? "text-indigo-300" : "text-zinc-400"}`}>
                      {speakerLabel[line.speaker]}
                    </p>
                    {line.text}
                    {line.cutOff && (
                      <em className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] not-italic text-amber-300">
                        cut off
                      </em>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}

const STATUS_STYLES: Record<InterviewStatus, { label: string; classes: string; dot: string }> = {
  idle: { label: "Ready", classes: "bg-zinc-800 text-zinc-300", dot: "bg-zinc-400" },
  connecting: { label: "Connecting", classes: "bg-amber-500/10 text-amber-300", dot: "bg-amber-400 animate-pulse" },
  live: { label: "Live", classes: "bg-rose-500/10 text-rose-300", dot: "bg-rose-500 animate-pulse" },
  ended: { label: "Ended", classes: "bg-zinc-800 text-zinc-300", dot: "bg-zinc-500" },
  error: { label: "Interrupted", classes: "bg-rose-500/10 text-rose-300", dot: "bg-rose-500" },
};

function StatusPill({ status }: { status: InterviewStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${style.classes}`}>
      <span className={`size-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function InterviewerIndicator({ state }: { state: InterviewerState }) {
  if (state === "speaking") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-indigo-300">
        <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
          {[0, 0.15, 0.3, 0.45].map((delay) => (
            <span key={delay} className="voice-bar h-full w-1 rounded-full bg-indigo-400" style={{ animationDelay: `${delay}s` }} />
          ))}
        </span>
        Interviewer speaking
      </span>
    );
  }
  if (state === "listening") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-emerald-300">
        <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
        Listening to you
      </span>
    );
  }
  return null;
}
