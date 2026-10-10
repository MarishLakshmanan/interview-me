import type { Speaker, TranscriptMessage } from "./messages";

export interface CaptionLine {
  text: string;
  /** True once the backend sent the finished line; the next partial then starts a new line. */
  final: boolean;
}

export type Captions = Record<Speaker, CaptionLine>;

export const emptyCaptions: Captions = {
  candidate: { text: "", final: true },
  interviewer: { text: "", final: true },
};

/**
 * Fold one transcript message into the caption lines: partial pieces are appended, a final replaces the line.
 *
 * @param captions The current caption lines for both sides.
 * @param message The transcript message that just arrived.
 * @returns The updated caption lines; the input is not modified.
 */
export function applyTranscript(captions: Captions, message: Pick<TranscriptMessage, "speaker" | "text" | "final">): Captions {
  const current = captions[message.speaker];
  const text = message.final ? message.text : current.final ? message.text : current.text + message.text;
  return { ...captions, [message.speaker]: { text, final: message.final } };
}
