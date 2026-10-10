import type { PlannedQuestion } from "../plan/planApi";

/** Messages the backend sends as text frames; see backend/app/bridge.py for the protocol. */
export type Speaker = "candidate" | "interviewer";

/**
 * Build the first message of an interview, which carries the question plan to the backend.
 *
 * @param plan (PlannedQuestion[]): The plan returned by POST /api/plan.
 * @returns string: The JSON text frame to send before any audio.
 */
export function buildStartMessage(plan: PlannedQuestion[]): string {
  return JSON.stringify({ type: "start", plan });
}

export interface TranscriptMessage {
  type: "transcript";
  speaker: Speaker;
  text: string;
  final: boolean;
}

export interface TranscriptLine {
  speaker: Speaker;
  text: string;
}

export type ServerMessage =
  | TranscriptMessage
  | { type: "question"; number: number }
  | { type: "interrupted" }
  | { type: "turn_complete" }
  | { type: "error"; message: string }
  | { type: "interview_ended"; reason: string; transcript: TranscriptLine[] };

const isSpeaker = (v: unknown): v is Speaker => v === "candidate" || v === "interviewer";

function parseLines(v: unknown): TranscriptLine[] | null {
  if (!Array.isArray(v)) return null;
  const lines: TranscriptLine[] = [];
  for (const item of v) {
    if (!item || !isSpeaker(item.speaker) || typeof item.text !== "string") return null;
    lines.push({ speaker: item.speaker, text: item.text });
  }
  return lines;
}

/**
 * Turn one text frame from the backend into a typed message.
 *
 * @param raw The frame's text.
 * @returns The message, or null if it is not valid JSON or not a known message shape.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  switch (data.type) {
    case "transcript":
      if (isSpeaker(data.speaker) && typeof data.text === "string" && typeof data.final === "boolean") {
        return { type: "transcript", speaker: data.speaker, text: data.text, final: data.final };
      }
      return null;
    case "question":
      return typeof data.number === "number" ? { type: "question", number: data.number } : null;
    case "interrupted":
    case "turn_complete":
      return { type: data.type };
    case "error":
      return typeof data.message === "string" ? { type: "error", message: data.message } : null;
    case "interview_ended": {
      const transcript = parseLines(data.transcript);
      return typeof data.reason === "string" && transcript
        ? { type: "interview_ended", reason: data.reason, transcript }
        : null;
    }
    default:
      return null;
  }
}
