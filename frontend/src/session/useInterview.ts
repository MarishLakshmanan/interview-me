import { useCallback, useEffect, useRef, useState } from "react";
import { startCapture, type Capture } from "../audio/capture";
import { WAITING_FOR_PERMISSION_MESSAGE } from "../audio/micErrors";
import { startPlayback, type Playback } from "../audio/playback";
import type { PlannedQuestion } from "../plan/planApi";
import { brokenInterviewMessage, closedConnectionMessage, endStatus } from "../failures";
import { buildStartMessage, parseServerMessage } from "./messages";
import { applyServerMessage, emptySession, interviewerState, type SessionData } from "./transcript";

export type InterviewStatus = "idle" | "connecting" | "live" | "ended" | "error";

export interface InterviewState extends SessionData {
  status: InterviewStatus;
  /** True while sound is coming out of the speakers (from the playback buffer, not server events). */
  interviewerSpeaking: boolean;
  errorMessage: string | null;
  /** A non-fatal hint, e.g. that we are waiting for the microphone permission prompt. */
  notice: string | null;
}

const initialState: InterviewState = {
  status: "idle",
  interviewerSpeaking: false,
  ...emptySession,
  errorMessage: null,
  notice: null,
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
        case "transcript":
        case "question":
          setState((s) => ({ ...s, ...applyServerMessage(s, message) }));
          break;
        case "interrupted":
          playback.current?.clear();
          setState((s) => ({ ...s, ...applyServerMessage(s, message) }));
          break;
        case "error":
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
      if (socket.current === ws) fail(closedConnectionMessage(startSent));
    };

    // Both audio contexts are created synchronously inside the click, before any await.
    const [pb, cap] = await Promise.allSettled([
      startPlayback((playing) => setState((s) => ({ ...s, interviewerSpeaking: playing }))),
      startCapture(
        (chunk) => {
          if (startSent && ws.readyState === WebSocket.OPEN) ws.send(chunk);
        },
        () => setState((s) => ({ ...s, notice: WAITING_FOR_PERMISSION_MESSAGE })),
      ),
    ]);
    setState((s) => (s.notice === null ? s : { ...s, notice: null }));
    if (pb.status === "fulfilled") playback.current = pb.value;
    if (cap.status === "fulfilled") capture.current = cap.value;
    const failure = [pb, cap].find((r) => r.status === "rejected");
    if (failure && failure.status === "rejected") {
      const reason = failure.reason;
      fail(reason instanceof Error ? reason.message : "Could not start the audio.");
    }
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
