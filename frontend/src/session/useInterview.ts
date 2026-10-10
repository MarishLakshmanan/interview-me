import { useCallback, useEffect, useRef, useState } from "react";
import { startCapture, type Capture } from "../audio/capture";
import { WAITING_FOR_PERMISSION_MESSAGE } from "../audio/micErrors";
import { startPlayback, type Playback } from "../audio/playback";
import type { PlannedQuestion } from "../plan/planApi";
import { brokenInterviewMessage, closedConnectionMessage, endStatus } from "../failures";
import { buildStartMessage, parseServerMessage } from "./messages";
import { settleAudio } from "./settleAudio";
import { applyServerMessage, emptySession, interviewerState, type SessionData } from "./transcript";

export type InterviewStatus = "idle" | "connecting" | "live" | "ended" | "error";

export interface InterviewState extends SessionData {
  status: InterviewStatus;
  /** True while sound is coming out of the speakers (from the playback buffer, not server events). */
  interviewerSpeaking: boolean;
  errorMessage: string | null;
  /** A non-fatal hint, e.g. that we are waiting for the microphone permission prompt. */
  notice: string | null;
  /**
   * The sample plan, when the backend said it ran the interview on that instead of the prepared plan
   * (null otherwise). The assessment must be graded against it.
   */
  samplePlan: PlannedQuestion[] | null;
}

const initialState: InterviewState = {
  status: "idle",
  interviewerSpeaking: false,
  ...emptySession,
  errorMessage: null,
  notice: null,
  samplePlan: null,
};

/**
 * Own one interview connection: the WebSocket, microphone capture and playback.
 * This is the single place the interview state lives, so a later avatar can read it from here.
 *
 * @returns The current state plus start(plan), end() and reset(). start sends the plan as the first message.
 */
export function useInterview() {
  const [state, setState] = useState<InterviewState>(initialState);
  const socket = useRef<WebSocket | null>(null);
  const capture = useRef<Capture | null>(null);
  const playback = useRef<Playback | null>(null);
  /** The last error message the backend sent on this connection, so a later close cannot hide it. */
  const backendError = useRef<string | null>(null);

  const release = useCallback(() => {
    capture.current?.stop();
    playback.current?.stop();
    capture.current = null;
    playback.current = null;
  }, []);

  const fail = useCallback(
    (message: string) => {
      release();
      socket.current?.close();
      socket.current = null;
      setState((s) => ({ ...s, status: "error", interviewerSpeaking: false, errorMessage: message, notice: null }));
    },
    [release],
  );

  const start = useCallback(async (plan: PlannedQuestion[]) => {
    if (socket.current) return;
    setState({ ...initialState, status: "connecting" });
    backendError.current = null;
    let startSent = false;

    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws/interview`);
    ws.binaryType = "arraybuffer";
    socket.current = ws;

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playback.current?.enqueue(event.data);
        return;
      }
      const message = parseServerMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case "plan_source":
          if (message.source === "sample") setState((s) => ({ ...s, samplePlan: message.plan ?? null }));
          break;
        case "transcript":
        case "question":
          setState((s) => ({ ...s, ...applyServerMessage(s, message) }));
          break;
        case "interrupted":
          playback.current?.clear();
          setState((s) => ({ ...s, ...applyServerMessage(s, message) }));
          break;
        case "error":
          backendError.current = message.message;
          setState((s) => ({ ...s, errorMessage: message.message }));
          break;
        case "interview_ended":
          release();
          socket.current = null;
          setState((s) => ({
            ...s,
            ...applyServerMessage(s, message),
            status: endStatus(message.reason),
            interviewerSpeaking: false,
            errorMessage: endStatus(message.reason) === "error" ? brokenInterviewMessage(s.errorMessage) : s.errorMessage,
          }));
          break;
      }
    };
    ws.onopen = () => {
      // The plan goes first, before any audio chunk is allowed through.
      ws.send(buildStartMessage(plan));
      startSent = true;
      setState((s) => (s.status === "connecting" ? { ...s, status: "live" } : s));
    };
    ws.onclose = () => {
      // Closed without "interview_ended": the backend was unreachable, or the connection dropped.
      // The transcript so far stays in the state; resuming is not attempted.
      // A specific reason the backend already sent (for example an invalid plan) is kept, not replaced.
      if (socket.current === ws) fail(closedConnectionMessage(startSent, backendError.current));
    };

    // Both audio contexts are created synchronously inside the click, before any await.
    const outcome = await settleAudio(
      startPlayback((playing) => setState((s) => ({ ...s, interviewerSpeaking: playing }))),
      startCapture(
        (chunk) => {
          if (startSent && ws.readyState === WebSocket.OPEN) ws.send(chunk);
        },
        () => setState((s) => ({ ...s, notice: WAITING_FOR_PERMISSION_MESSAGE })),
      ),
      // This attempt is current only while its own socket is the live one: fail(), the end of the
      // interview and unmount all clear it, and a new start replaces it.
      () => socket.current === ws,
    );
    // A stale attempt must not clear the notice of a newer attempt that has started since.
    if (outcome.kind !== "stale" || socket.current === null) {
      setState((s) => (s.notice === null ? s : { ...s, notice: null }));
    }
    if (outcome.kind === "stale") return;
    if (outcome.kind === "failed") {
      fail(outcome.message);
      return;
    }
    playback.current = outcome.playback;
    capture.current = outcome.capture;
  }, [fail, release]);

  const end = useCallback(() => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: "end" }));
    }
  }, []);

  /** Clear a finished interview so the next screen starts clean; does nothing while one is running. */
  const reset = useCallback(() => {
    if (socket.current === null) setState(initialState);
  }, []);

  useEffect(
    () => () => {
      release();
      const ws = socket.current;
      socket.current = null;
      ws?.close();
    },
    [release],
  );

  const live = state.status === "connecting" || state.status === "live";
  return { ...state, interviewerState: interviewerState(live, state.interviewerSpeaking), start, end, reset };
}
