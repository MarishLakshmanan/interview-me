import type { ServerMessage, Speaker, TranscriptLine } from "./messages";

/** One line of the on-screen transcript. */
export interface TranscriptEntry {
  speaker: Speaker;
  text: string;
  /** True once the backend sent the finished line; the next partial then starts a new line. */
  final: boolean;
  /** True when the interviewer was interrupted while this line was being spoken. */
  cutOff: boolean;
  /** The planned question number that was current when the line was first seen (null before the first). */
  question: number | null;
}

/** The part of the interview state that only the backend's messages change. */
export interface SessionData {
  lines: TranscriptEntry[];
  question: number | null;
  /** Why the interview ended (the backend's reason), or null while it is still running. */
  endReason: string | null;
}

export const emptySession: SessionData = { lines: [], question: null, endReason: null };

function lastIndexWhere(lines: TranscriptEntry[], test: (line: TranscriptEntry) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i--) if (test(lines[i])) return i;
  return -1;
}

function withLine(lines: TranscriptEntry[], index: number, change: Partial<TranscriptEntry>): TranscriptEntry[] {
  return lines.map((line, i) => (i === index ? { ...line, ...change } : line));
}

/**
 * Fold one transcript piece in: partials extend the speaker's in-progress line, a final commits it.
 *
 * @param lines The transcript so far.
 * @param message The speaker, text and final flag that just arrived.
 * @param question The current question number; a line is tagged with it when it is first seen and keeps it.
 * @returns The new transcript; the input is not modified.
 */
function applyTranscript(
  lines: TranscriptEntry[],
  message: { speaker: Speaker; text: string; final: boolean },
  question: number | null,
): TranscriptEntry[] {
  const newest = lastIndexWhere(lines, (line) => line.speaker === message.speaker);
  const open = newest >= 0 && !lines[newest].final ? newest : -1;
  const openLine = open >= 0 ? lines[open] : null;

  if (message.final) {
    if (openLine) return withLine(lines, open, { text: message.text, final: true });
    return [...lines, { speaker: message.speaker, text: message.text, final: true, cutOff: false, question }];
  }
  if (openLine && !openLine.cutOff) return withLine(lines, open, { text: openLine.text + message.text });
  // A partial after a cut-off (or after a final) belongs to a new line.
  const closed = openLine ? withLine(lines, open, { final: true }) : lines;
  return [...closed, { speaker: message.speaker, text: message.text, final: false, cutOff: false, question }];
}

/**
 * Mark the interviewer line the candidate interrupted, so it shows as cut off instead of vanishing.
 *
 * @param lines The transcript so far.
 * @returns The new transcript; unchanged if the interviewer has nothing on screen to cut off.
 */
function markCutOff(lines: TranscriptEntry[]): TranscriptEntry[] {
  const index = lastIndexWhere(lines, (line) => line.speaker === "interviewer");
  if (index < 0) return lines;
  // An interruption only hits speech that was still being generated: an interviewer line still open,
  // or the newest line of the whole transcript. Older finished lines were already fully spoken.
  const isNewest = index === lines.length - 1;
  if (!isNewest && lines[index].final) return lines;
  return withLine(lines, index, { cutOff: true });
}

function fromFinished(lines: TranscriptLine[], question: number | null): TranscriptEntry[] {
  return lines.map((line) => ({ ...line, final: true, cutOff: false, question }));
}

/**
 * Apply one backend message to the interview data.
 *
 * @param data The current transcript, question number and end reason.
 * @param message The message that just arrived.
 * @returns The new data; the input is not modified.
 */
export function applyServerMessage(data: SessionData, message: ServerMessage): SessionData {
  switch (message.type) {
    case "transcript":
      return { ...data, lines: applyTranscript(data.lines, message, data.question) };
    case "question":
      return { ...data, question: message.number };
    case "interrupted":
      return { ...data, lines: markCutOff(data.lines) };
    case "interview_ended": {
      // Keep what was shown (with cut-off marks); the backend's finished lines are only a fallback.
      const shown = data.lines.filter((line) => line.text.trim() !== "").map((line) => (line.final ? line : { ...line, final: true }));
      const lines = shown.length > 0 ? shown : fromFinished(message.transcript, data.question);
      return { ...data, lines, endReason: message.reason };
    }
    default:
      return data;
  }
}

/** Who spoke, as shown in the transcript and the downloaded file. */
export const speakerLabel: Record<Speaker, string> = { candidate: "You", interviewer: "Interviewer" };

/**
 * Turn the transcript into plain text for download.
 *
 * @param lines The transcript lines.
 * @returns One paragraph per line, cut-off lines marked, ending in a newline.
 */
export function transcriptToText(lines: TranscriptEntry[]): string {
  return lines.map((line) => `${speakerLabel[line.speaker]}: ${line.text}${line.cutOff ? " [cut off]" : ""}`).join("\n\n") + "\n";
}

/**
 * Say how far through the plan the interview is.
 *
 * @param question The backend's current question number, or null before the first one.
 * @param total How many questions the plan has.
 * @returns A phrase like "question 3 of 7" (capped at the plan's length), or null if none is current.
 */
export function questionProgressText(question: number | null, total: number): string | null {
  if (question === null) return null;
  return `question ${Math.min(question, total)} of ${total}`;
}

export type InterviewerState = "idle" | "speaking" | "listening";

/**
 * Work out what the interviewer is doing, for the page and for a later avatar.
 *
 * @param live True while the interview is connected and running.
 * @param playing True while sound is coming out of the playback buffer (already held briefly).
 * @returns "speaking" while audio plays, "listening" while live and quiet, otherwise "idle".
 */
export function interviewerState(live: boolean, playing: boolean): InterviewerState {
  if (!live) return "idle";
  return playing ? "speaking" : "listening";
}

/**
 * Say in plain words why the interview ended.
 *
 * @param reason The backend's end reason, such as "completed" or "time_limit".
 * @returns A sentence for the candidate.
 */
export function endReasonText(reason: string): string {
  switch (reason) {
    case "completed":
      return "The interview finished.";
    case "candidate":
      return "You ended the interview.";
    case "candidate_left":
      return "The interview ended because the page was closed.";
    case "time_limit":
      return "The interview reached its time limit.";
    case "error":
      return "The interview stopped because of an error.";
    default:
      return `The interview ended (${reason}).`;
  }
}
